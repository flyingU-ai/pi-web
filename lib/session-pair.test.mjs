import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  packIntentConclusions,
  replaceUnsentPack,
  commitPairDelivery,
  readPair,
  writePair,
  PAIR_MARK_END,
} = await jiti.import("./session-pair.ts");

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test("pack keeps intent and the last human-facing conclusion", () => {
  const messages = [
    { role: "user", content: "先看 bug" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "我先读文件" },
        { type: "toolCall", toolName: "bash", input: { command: "pytest" } },
      ],
    },
    { role: "toolResult", content: [{ type: "text", text: "FAILED test_a" }] },
    { role: "bashExecution", command: "pytest", output: "log" },
    { role: "assistant", content: [{ type: "text", text: "失败在 test_a，先改断言。" }] },
    { role: "user", content: "再给一版策略" },
    { role: "assistant", content: [{ type: "toolCall", toolName: "read", input: {} }] },
  ];
  const ids = ["u1", "a1", "t1", "b1", "a2", "u2", "a3"];
  const packed = packIntentConclusions(messages, ids, undefined, "论证席", "p1");
  assert.equal(packed.rounds, 2);
  assert.match(packed.text, /意图：先看 bug/);
  assert.match(packed.text, /结论：失败在 test_a，先改断言。/);
  assert.doesNotMatch(packed.text, /pytest|FAILED|hidden|我先读文件/);
  assert.match(packed.text, /意图：再给一版策略/);
  assert.match(packed.text, /结论：这一轮没有单独的结论/);
  assert.equal(packed.throughEntryId, "a3");
  assert.ok(packed.text.endsWith(`${PAIR_MARK_END}\n`));
});

test("already delivered rounds stay out of the next pack", () => {
  const messages = [
    { role: "user", content: "第一问" },
    { role: "assistant", content: [{ type: "text", text: "第一结论" }] },
    { role: "user", content: "第二问" },
    { role: "assistant", content: [{ type: "text", text: "第二结论" }] },
  ];
  const ids = ["u1", "a1", "u2", "a2"];
  const packed = packIntentConclusions(messages, ids, "a1", "论证席", "p2");
  assert.equal(packed.rounds, 1);
  assert.match(packed.text, /第二问/);
  assert.doesNotMatch(packed.text, /第一问/);
});

test("replacing a draft keeps the sentence typed after it", () => {
  const existing = "【对席 old】\n来自「A」\n1. 意图：旧\n   结论：旧结论\n【对席完】\n执行一下，先安排并实现";
  const next = replaceUnsentPack(existing, "【对席 new】\n来自「A」\n1. 意图：新\n   结论：新结论\n【对席完】\n");
  assert.match(next, /意图：新/);
  assert.doesNotMatch(next, /意图：旧/);
  assert.match(next, /执行一下，先安排并实现/);
});

test("delivery is recorded only when that pack is actually sent", () => {
  const storage = memoryStorage();
  writePair("scope", {
    criticId: "a",
    workerId: "b",
    sentThrough: {},
    pending: { packId: "p9", sourceId: "a", targetId: "b", throughEntryId: "a2" },
  }, storage);

  commitPairDelivery("scope", "b", "我自己写的另一句", storage);
  assert.equal(readPair("scope", storage).pending.packId, "p9");
  assert.equal(readPair("scope", storage).sentThrough.a, undefined);

  commitPairDelivery("scope", "b", "【对席 p9】\n来自「A」\n1. 意图：问\n   结论：答\n【对席完】\n执行一下", storage);
  const saved = readPair("scope", storage);
  assert.equal(saved.pending, null);
  assert.equal(saved.sentThrough.a, "a2");
});
