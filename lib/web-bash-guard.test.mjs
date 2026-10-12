import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  BASH_IDLE_SECONDS,
  BASH_START_GRACE_SECONDS,
  BASH_WALL_FALLBACK_SECONDS,
  FLEET_MAX_TOKENS,
  FLEET_SLOT_CTX,
  denyBashCommand,
  denyFindTool,
  denyGrepTool,
  isDatePoolRoot,
  isPoolHeavyDir,
  isWalkLikeCommand,
  resolveBashTimeout,
} = await createJiti(import.meta.url).import("./web-bash-guard.ts");

const POOL = "/dataset/coco_fu/AgentSMarkDatePoolv2";

test("fleet numbers match :8091 per-slot truth", () => {
  assert.equal(FLEET_SLOT_CTX, 131072);
  assert.equal(FLEET_MAX_TOKENS, 65536);
  assert.equal(BASH_IDLE_SECONDS, 120);
  assert.equal(BASH_START_GRACE_SECONDS, 180);
  assert.equal(BASH_WALL_FALLBACK_SECONDS, 86400);
});

test("honors asked bash timeout and does not invent a 60s wall", () => {
  assert.equal(resolveBashTimeout(undefined), undefined);
  assert.equal(resolveBashTimeout(0), undefined);
  assert.equal(resolveBashTimeout(3600), 3600);
  assert.equal(resolveBashTimeout(15), 15);
});

test("denies DatePool root walks", () => {
  assert.match(denyBashCommand("ls"), /池根/);
  assert.match(denyBashCommand("ls -la"), /池根/);
  assert.match(denyBashCommand("ls ."), /池根/);
  assert.match(denyBashCommand("find /"), /find \//);
  assert.match(denyBashCommand("find . -type d"), /maxdepth|扫仓/);
  assert.match(denyBashCommand("du -sh ."), /du/);
  assert.match(denyBashCommand("grep -rn foo /"), /grep/);
  assert.match(denyBashCommand('python -c "import os; os.listdir(DR)"'), /listdir/);
  assert.match(denyBashCommand("with Pool(32) as p: p.imap(listdir, dirs)"), /多进程/);
});

test("allows targeted listing under an @ warehouse", () => {
  assert.equal(denyBashCommand("ls smt_benchmark | head"), null);
  assert.equal(denyBashCommand("ls smt_benchmark"), null);
  assert.equal(denyBashCommand("pgrep -a test_data_gen"), null);
  assert.equal(denyBashCommand("curl -sf http://127.0.0.1:8091/v1/models"), null);
  assert.equal(denyBashCommand("node pi_engine/scripts/page_accept.mjs --tab distribution"), null);
});

test("denies product-repo writes in bash", () => {
  const prev = process.env.AGENTSMARK_ROOT;
  process.env.AGENTSMARK_ROOT = "/home/aoi/hyf/datavisualization_langgraph/data_engine/agentSMark";
  try {
    assert.match(
      denyBashCommand("rm /home/aoi/hyf/datavisualization_langgraph/data_engine/agentSMark/frontend/src/App.tsx"),
      /只读/,
    );
  } finally {
    if (prev === undefined) delete process.env.AGENTSMARK_ROOT;
    else process.env.AGENTSMARK_ROOT = prev;
  }
});

test("recognizes DatePool roots and denies their ls", () => {
  assert.equal(isDatePoolRoot("/dataset/coco_fu/AgentSMarkDatePoolv2"), true);
  assert.equal(isDatePoolRoot("/tmp/DatePool"), true);
  assert.equal(isDatePoolRoot("/tmp/DatePool/smt_benchmark"), false);
  assert.match(denyBashCommand("ls /dataset/coco_fu/AgentSMarkDatePoolv2"), /池根/);
});

test("denies unbounded find including cache and pool-relative paths", () => {
  const prev = process.env.ANNOTATION_WORKSPACE_ROOT;
  process.env.ANNOTATION_WORKSPACE_ROOT = POOL;
  try {
    assert.match(denyBashCommand("find cache -name '*.jpg'", POOL), /maxdepth/);
    assert.match(denyBashCommand(`find ${POOL} -name '*.jpg'`, POOL), /maxdepth|find \//);
    assert.match(denyBashCommand("find smt_benchmark -type d", POOL), /maxdepth/);
    assert.match(denyBashCommand("find . -maxdepth 1", POOL), /池根|cache/);
    assert.match(denyBashCommand("find cache -maxdepth 1", POOL), /cache|池根/);
    assert.equal(denyBashCommand("find smt_benchmark -maxdepth 1 | head", POOL), null);
    assert.equal(
      denyBashCommand("find smt_benchmark/data/BoardA -maxdepth 2 -name '*.json' | head", POOL),
      null,
    );
    assert.match(denyBashCommand("fd --glob '**/stem.json' .", POOL), /fd/);
    assert.match(
      denyBashCommand("python - <<'PY'\nfrom pathlib import Path\nlist(Path('.').rglob('*.png'))\nPY"),
      /rglob/,
    );
    assert.equal(isWalkLikeCommand("find cache -name '*.jpg'"), true);
    assert.equal(isWalkLikeCommand("ls smt_benchmark | head"), false);
    assert.equal(isPoolHeavyDir(`${POOL}/cache`), true);
    assert.equal(isPoolHeavyDir(`${POOL}/smt_benchmark`), false);
  } finally {
    if (prev === undefined) delete process.env.ANNOTATION_WORKSPACE_ROOT;
    else process.env.ANNOTATION_WORKSPACE_ROOT = prev;
  }
});

test("denies coding-agent find/grep on DatePool root", () => {
  const prev = process.env.ANNOTATION_WORKSPACE_ROOT;
  process.env.ANNOTATION_WORKSPACE_ROOT = POOL;
  try {
    assert.match(denyFindTool({ pattern: "**/stem.json" }, POOL), /FIND_DENIED|池根|cache/);
    assert.match(denyFindTool({ path: POOL, pattern: "*.json" }, POOL), /FIND_DENIED|池根/);
    assert.match(denyFindTool({ path: "cache", pattern: "*.jpg" }, POOL), /FIND_DENIED|cache/);
    assert.match(denyFindTool({ path: "smt_benchmark", pattern: "*.json" }, POOL), /第二层/);
    assert.equal(
      denyFindTool({ path: "smt_benchmark/data/BoardA", pattern: "*.json" }, POOL),
      null,
    );
    assert.match(denyGrepTool({ pattern: "n_bad" }, POOL), /GREP_DENIED|池根/);
    assert.equal(
      denyGrepTool({ path: "benchmark/smt_benchmark_dual_probe_r01_20261009/meta.json", pattern: "n_bad" }, POOL),
      null,
    );
  } finally {
    if (prev === undefined) delete process.env.ANNOTATION_WORKSPACE_ROOT;
    else process.env.ANNOTATION_WORKSPACE_ROOT = prev;
  }
});
