import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { formatToolDuration, toolTimerLabel } = await jiti.import("./tool-timer.ts");

test("formats the same durations as pi's tool row", () => {
  assert.equal(formatToolDuration(4200), "4.2s");
  assert.equal(formatToolDuration(10400), "10.4s");
  assert.equal(formatToolDuration(90_000), "1m 30s");
  assert.equal(formatToolDuration(7_384_000), "2h 3m 4s");
});

test("labels a live row Elapsed and a finished row Took", () => {
  assert.equal(toolTimerLabel({
    isPartial: true,
    startedAt: 1_000,
    now: 5_200,
  }), "Elapsed 4.2s");
  assert.equal(toolTimerLabel({
    isPartial: false,
    durationMs: 10_400,
  }), "Took 10.4s");
  assert.equal(toolTimerLabel({ isPartial: true }), null);
});
