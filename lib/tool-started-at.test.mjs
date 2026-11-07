import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  rememberToolStartedAt,
  forgetToolStartedAt,
  forgetSessionToolStartedAt,
} = await jiti.import("./tool-started-at.ts");

test("a reconnect keeps the original start time", () => {
  const first = rememberToolStartedAt("s1", "tool-a", 1_000);
  const again = rememberToolStartedAt("s1", "tool-a", 9_000);
  assert.equal(first, 1_000);
  assert.equal(again, 1_000);
  forgetToolStartedAt("s1", "tool-a");
});

test("sessions do not share clocks", () => {
  rememberToolStartedAt("s1", "tool-a", 1_000);
  assert.equal(rememberToolStartedAt("s2", "tool-a", 2_000), 2_000);
  forgetSessionToolStartedAt("s1");
  forgetSessionToolStartedAt("s2");
});

test("forgetting a session drops only that session's clocks", () => {
  rememberToolStartedAt("s1", "a", 1);
  rememberToolStartedAt("s2", "a", 2);
  forgetSessionToolStartedAt("s1");
  assert.equal(rememberToolStartedAt("s1", "a", 9), 9);
  assert.equal(rememberToolStartedAt("s2", "a", 8), 2);
  forgetSessionToolStartedAt("s1");
  forgetSessionToolStartedAt("s2");
});
