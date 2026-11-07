import assert from "node:assert/strict";
import test from "node:test";

import { formatAbsoluteTime, formatRelativeTime, formatUpdatedTime, interpolateMessage, translateMessage } from "./format.ts";

test("interpolates string and numeric parameters", () => {
  assert.equal(interpolateMessage("Hello, {name} ({count})", { name: "Pi", count: 2 }), "Hello, Pi (2)");
});

test("falls back to English and returns the key when both are missing", () => {
  assert.equal(translateMessage("zh-CN", "common.ok", { en: { "common.ok": "OK" }, "zh-CN": {} }), "OK");
  assert.equal(translateMessage("zh-CN", "missing.key", { en: {}, "zh-CN": {} }), "missing.key");
});

test("formats relative time using the selected locale", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(formatRelativeTime(new Date("2026-01-01T00:05:00.000Z"), "en", now), "in 5 minutes");
  assert.equal(formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), "zh-CN", now), "1小时前");
  assert.equal(formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), "zh-TW", now), "1 小時前");
});

test("shows a Beijing clock today and a relative day for earlier updates", () => {
  const now = new Date("2026-09-22T13:18:00.000Z");
  const today = new Date("2026-09-22T01:05:00.000Z");
  const earlier = new Date("2026-09-19T13:18:00.000Z");
  assert.equal(
    formatUpdatedTime(today.getTime(), "zh-CN", now),
    today.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai" }),
  );
  assert.equal(formatUpdatedTime(earlier.getTime(), "zh-CN", now), "3天前");
  assert.equal(formatUpdatedTime(earlier.getTime(), "en", now), "3 days ago");
  assert.equal(formatUpdatedTime(earlier.getTime(), "zh-TW", now), "3 天前");
});

test("absolute clocks stay on Beijing time when the host clock is UTC", () => {
  const now = new Date("2026-11-08T20:33:00.000Z");
  const afternoon = Date.parse("2026-11-07T07:23:00.000Z");
  const text = formatAbsoluteTime(afternoon, "zh-CN", now);
  assert.match(text, /15:23/);
  assert.match(text, /11月7日/);
  const lateUtc = Date.parse("2026-11-07T16:30:00.000Z");
  const shanghaiMorning = new Date("2026-11-07T18:00:00.000Z");
  assert.equal(formatAbsoluteTime(lateUtc, "zh-CN", shanghaiMorning), "00:30");
});
