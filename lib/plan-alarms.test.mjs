import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  capturePlanAlarm,
  extractPlanRows,
  mergePlanRows,
} = await jiti.import("./plan-alarms.ts");
const { adminFromSessionFile, isHostPrivateAdminPath } = await jiti.import("./web-admin-scope.ts");
const { isFilePathAllowed } = await jiti.import("./file-access.ts");

const PLAN = `
4. 下一步（我盯着）

| 时间 | 事件 |
| --- | --- |
| ~15:45 | v7-anchor rank1 收尾 |
| ~16:20 | v8a rank0 收尾 → 全量 bench 评估 v8a |
| ~16:40 | v8b 出 VAL 曲线 |
| ~17:20 | 四方全量逐类表齐 |

定稿判据不变：SMT≥.9500 且 DIP≥.8550 才算过。
`;

const NOW = Date.parse("2026-11-10T07:00:00.000Z");

test("a watch table becomes four future alarms with the model's criterion", () => {
  const rows = extractPlanRows(PLAN, NOW);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].at, "2026-11-10T07:45:00.000Z");
  assert.equal(rows[1].at, "2026-11-10T08:20:00.000Z");
  assert.match(rows[1].event, /全量 bench/);
  assert.match(rows[3].criterion, /SMT≥\.9500/);
  assert.equal(rows[3].fired, false);
});

test("prose without the watch heading and a results table do not arm", () => {
  assert.deepEqual(extractPlanRows("15:45 的日志里 val 是 .9386", NOW), []);
  assert.deepEqual(extractPlanRows("| step | val |\n| --- | --- |\n| 100 | .8646 |", NOW), []);
});

test("a clock time already passed today is the next occurrence inside 24h", () => {
  const text = "下一步（我盯着）\n\n| 时间 | 事件 |\n| --- | --- |\n| 14:00 | 补看昨日曲线 |\n";
  const rows = extractPlanRows(text, NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].at, "2026-11-11T06:00:00.000Z");
});

test("capture writes under the admin alarm dir and a later note does not erase it", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-alarm-"));
  const previous = process.env.PI_WEB_SESSIONS_ROOT;
  process.env.PI_WEB_SESSIONS_ROOT = root;
  try {
    const sessionFile = join(root, "gaolele", "pi", "2026_01.jsonl");
    mkdirSync(join(root, "gaolele", "pi"), { recursive: true });
    writeFileSync(sessionFile, "");
    const sessionId = "01a1af79-16b2-7442-8915-ecc6e7ab1070";
    const dest = capturePlanAlarm({ sessionId, sessionFile, text: PLAN, nowMs: NOW });
    assert.equal(dest, join(root, "gaolele", "alarms", `${sessionId}.json`));
    const saved = JSON.parse(readFileSync(dest, "utf8"));
    assert.equal(saved.rows.length, 4);
    assert.equal(capturePlanAlarm({ sessionId, sessionFile, text: "好的", nowMs: NOW }), "");
    assert.equal(JSON.parse(readFileSync(dest, "utf8")).rows.length, 4);
    const fired = saved.rows.map((row, index) => ({ ...row, fired: index === 0 }));
    const merged = mergePlanRows(fired, extractPlanRows(PLAN, NOW));
    assert.equal(merged[0].fired, true);
    assert.equal(merged.filter((row) => !row.fired).length, 3);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("ssh and alarm files stay out of the file tree even when the session root is allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-secret-"));
  const previous = process.env.PI_WEB_SESSIONS_ROOT;
  process.env.PI_WEB_SESSIONS_ROOT = root;
  try {
    const sessionFile = join(root, "gaolele", "pi", "s.jsonl");
    assert.equal(adminFromSessionFile(sessionFile), "gaolele");
    const secret = join(root, "gaolele", "ssh", "id_ed25519");
    const alarm = join(root, "gaolele", "alarms", "s.json");
    const roots = new Set([root]);
    assert.equal(isHostPrivateAdminPath(secret), true);
    assert.equal(isFilePathAllowed(secret, roots), false);
    assert.equal(isFilePathAllowed(alarm, roots), false);
    assert.equal(isFilePathAllowed(sessionFile, roots), true);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
