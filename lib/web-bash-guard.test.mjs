import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  BASH_WALL_FALLBACK_SECONDS,
  FLEET_MAX_TOKENS,
  FLEET_SLOT_CTX,
  isDatePoolRoot,
  isPoolHeavyDir,
  isWalkLikeCommand,
  resolveBashTimeout,
} = await createJiti(import.meta.url).import("./web-bash-guard.ts");

const POOL = "/dataset/coco_fu/AgentSMarkDatePoolv2";

test("fleet numbers match :8091 per-slot truth", () => {
  assert.equal(FLEET_SLOT_CTX, 131072);
  assert.equal(FLEET_MAX_TOKENS, 16384);
  assert.equal(BASH_WALL_FALLBACK_SECONDS, 86400);
});

test("honors asked bash timeout and does not invent a 60s wall", () => {
  assert.equal(resolveBashTimeout(undefined), undefined);
  assert.equal(resolveBashTimeout(0), undefined);
  assert.equal(resolveBashTimeout(3600), 3600);
  assert.equal(resolveBashTimeout(15), 15);
});

test("classifies DatePool roots for file-index, without bash denies", () => {
  assert.equal(isDatePoolRoot("/dataset/coco_fu/AgentSMarkDatePoolv2"), true);
  assert.equal(isDatePoolRoot("/tmp/DatePool"), true);
  assert.equal(isDatePoolRoot("/tmp/DatePool/smt_benchmark"), false);
  assert.equal(isPoolHeavyDir(`${POOL}/cache`), true);
  assert.equal(isPoolHeavyDir(`${POOL}/smt_benchmark`), false);
});

test("walk-like is a classifier, not a deny", () => {
  assert.equal(isWalkLikeCommand("find cache -name '*.jpg'"), true);
  assert.equal(isWalkLikeCommand("ls smt_benchmark | head"), false);
  assert.equal(isWalkLikeCommand("du -sh ."), true);
});
