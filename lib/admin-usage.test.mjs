import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { beijingDay, formatUsageDigest, listAdminUsage } = await jiti.import("./admin-usage.ts");

test("beijing day is YYYY-MM-DD", () => {
  assert.match(beijingDay(Date.parse("2026-11-18T16:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
});

test("usage aggregates jsonl by admin and day", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-usage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const prev = process.env.PI_WEB_SESSIONS_ROOT;
  const prevWh = process.env.ANNOTATION_WORKSPACE_ROOT;
  process.env.PI_WEB_SESSIONS_ROOT = root;
  process.env.ANNOTATION_WORKSPACE_ROOT = root;
  process.env.PI_WEB_SUPERADMINS = "flyingu";
  mkdirSync(join(root, "flyingu", "pi"), { recursive: true });
  const ts = Date.parse("2026-11-18T04:00:00Z");
  writeFileSync(join(root, "flyingu", "pi", "s.jsonl"), `${JSON.stringify({
    type: "message",
    timestamp: ts,
    message: { role: "assistant", usage: { input: 10, output: 4, cacheRead: 2, cost: { total: 0.01 } }, provider: "llamacpp" },
  })}\n`);
  try {
    const out = listAdminUsage({ viewer: "flyingu", from: "2026-11-18", to: "2026-11-18" });
    assert.equal(out.estimate, true);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].input, 10);
    assert.equal(out.rows[0].output, 4);
    assert.equal(out.rows[0].cache, 2);
    assert.match(formatUsageDigest(out.rows, "2026-11-18"), /flyingu/);
    const other = listAdminUsage({ viewer: "gaolele", from: "2026-11-18", to: "2026-11-18" });
    assert.equal(other.rows.length, 0);
  } finally {
    if (prev === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = prev;
    if (prevWh === undefined) delete process.env.ANNOTATION_WORKSPACE_ROOT;
    else process.env.ANNOTATION_WORKSPACE_ROOT = prevWh;
  }
});
