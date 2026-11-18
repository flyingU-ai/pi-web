import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  cacheHitPercent,
  formatCacheHitPercent,
  latestAssistantUsage,
  sessionReportsCache,
} = await jiti.import("./session-stats.ts");

test("hit rate uses uncached input as the remainder", () => {
  // DeepSeek sample: 231 uncached + 43392 cache read + 135 output = 43758.
  const percent = cacheHitPercent({ input: 231, cacheRead: 43392, cacheWrite: 0 });
  assert.ok(percent > 99 && percent < 100);
  assert.equal(sessionReportsCache({ cacheRead: 43392, cacheWrite: 0 }), true);
});

test("a reported miss is 0, and a session with no cache fields stays unreported", () => {
  assert.equal(cacheHitPercent({ input: 15868, cacheRead: 0, cacheWrite: 0 }), 0);
  assert.equal(sessionReportsCache({ cacheRead: 0, cacheWrite: 0 }), false);
  assert.equal(formatCacheHitPercent(null, "未回报"), "未回报");
  assert.equal(formatCacheHitPercent(0, "未回报"), "0.0%");
});

test("latest assistant usage is the last message that recorded usage", () => {
  const usage = latestAssistantUsage([
    { role: "user" },
    { role: "assistant", usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } },
    { role: "assistant", usage: { input: 4, output: 1, cacheRead: 80, cacheWrite: 0 } },
    { role: "user" },
  ]);
  assert.deepEqual(usage, { input: 4, output: 1, cacheRead: 80, cacheWrite: 0 });
});
