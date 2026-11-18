import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  packIntentConclusions,
  pairPackBounds,
  listUserTurns,
  nextPairSelection,
  mergePairDraft,
  stripUnsentPack,
  replaceUnsentPack,
  commitPairDelivery,
  readPair,
  writePair,
  cycleSeat,
  seatOf,
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
  assert.doesNotMatch(packed.text, /对席/);
  assert.doesNotMatch(packed.text, /来自「/);
});

test("a chosen end stops the first pack, and a later pack continues past it", () => {
  const messages = [
    { role: "user", content: "第一问" },
    { role: "assistant", content: [{ type: "text", text: "第一结论" }] },
    { role: "user", content: "第二问" },
    { role: "assistant", content: [{ type: "text", text: "第二结论" }] },
    { role: "user", content: "第三问" },
    { role: "assistant", content: [{ type: "text", text: "第三结论" }] },
  ];
  const ids = ["u1", "a1", "u2", "a2", "u3", "a3"];
  const turns = listUserTurns(messages, ids);
  assert.equal(turns[1].skipBeforeEntryId, "a1");
  assert.equal(turns[1].throughEntryId, "a2");
  const first = packIntentConclusions(messages, ids, turns[1].skipBeforeEntryId, "论证席", "p3", "a2");
  assert.equal(first.rounds, 1);
  assert.match(first.text, /第二问/);
  assert.doesNotMatch(first.text, /第一问|第三问/);
  assert.equal(first.throughEntryId, "a2");
  const pair = {
    criticId: "a",
    workerId: "b",
    sentThrough: { a: "a2" },
    rangeStart: { a: "u2" },
    rangeEnd: { a: "a2" },
    pending: null,
  };
  assert.deepEqual(pairPackBounds(pair, "a"), {
    delivered: false,
    startUserId: "u2",
    until: "a2",
  });
  const continued = { ...pair, rangeStart: {}, rangeEnd: {} };
  assert.deepEqual(pairPackBounds(continued, "a"), { delivered: true, after: "a2" });
  const next = packIntentConclusions(messages, ids, "a2", "论证席", "p4");
  assert.match(next.text, /第三问/);
  assert.doesNotMatch(next.text, /第二问/);
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

test("double-click selects one turn, a second cell, or cancels the cell", () => {
  const turns = [
    { userEntryId: "u1", throughEntryId: "a1", label: "一" },
    { userEntryId: "u2", throughEntryId: "a2", label: "二" },
    { userEntryId: "u3", throughEntryId: "a3", label: "三" },
    { userEntryId: "u4", throughEntryId: "a4", label: "四" },
  ];
  const first = nextPairSelection(turns, undefined, undefined, undefined, turns[1]);
  assert.deepEqual(
    { start: first.startUserId, end: first.endThroughId },
    { start: "u2", end: "a2" },
  );

  const between = nextPairSelection(turns, first.startUserId, first.endThroughId, first.lastClickedUserId, turns[3]);
  assert.equal(between.startUserId, "u2");
  assert.equal(between.endThroughId, "a4");

  const cancelled = nextPairSelection(turns, between.startUserId, between.endThroughId, between.lastClickedUserId, turns[3]);
  assert.equal(cancelled.startUserId, "u2");
  assert.equal(cancelled.endThroughId, "a2");

  const cleared = nextPairSelection(turns, cancelled.startUserId, cancelled.endThroughId, cancelled.lastClickedUserId, turns[1]);
  assert.equal(cleared.startUserId, undefined);
  assert.equal(cleared.endThroughId, undefined);
});

test("the inclusive range keeps both intents and conclusions", () => {
  const messages = [
    { role: "user", content: "第一问" },
    { role: "assistant", content: [{ type: "thinking", thinking: "过程" }, { type: "text", text: "第一结论" }] },
    { role: "user", content: "第二问" },
    { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }] },
    { role: "assistant", content: [{ type: "text", text: "第二结论" }] },
    { role: "user", content: "第三问" },
    { role: "assistant", content: [{ type: "text", text: "第三结论" }] },
  ];
  const ids = ["u1", "a1", "u2", "t2", "a2", "u3", "a3"];
  const turns = listUserTurns(messages, ids);
  const picked = nextPairSelection(turns, "u1", "a1", "u1", turns[2]);
  assert.equal(picked.startUserId, "u1");
  assert.equal(picked.endThroughId, "a3");
  const start = turns.find((turn) => turn.userEntryId === picked.startUserId);
  const packed = packIntentConclusions(messages, ids, start.skipBeforeEntryId, "论证席", "p", picked.endThroughId);
  assert.equal(packed.rounds, 3);
  assert.match(packed.text, /第一问/);
  assert.match(packed.text, /第一结论/);
  assert.match(packed.text, /第三问/);
  assert.match(packed.text, /第三结论/);
  assert.doesNotMatch(packed.text, /过程/);
  assert.doesNotMatch(packed.text, /ls/);
});

test("replacing a draft keeps the sentence typed after it", () => {
  const previous = "意图：旧\n结论：旧结论";
  const existing = `${previous}\n执行一下，先安排并实现`;
  const next = replaceUnsentPack(existing, "意图：新\n结论：新结论", previous);
  assert.match(next, /意图：新/);
  assert.doesNotMatch(next, /意图：旧/);
  assert.match(next, /执行一下，先安排并实现/);
  assert.doesNotMatch(next, /对席/);
});

test("an automatic draft keeps a typed note and leaves an untagged draft alone", () => {
  const previous = "意图：旧\n结论：旧结论";
  const pack = "意图：新\n结论：新结论";
  const updated = mergePairDraft(`${previous}\n先安排并实现`, pack, "auto", previous);
  assert.match(updated, /先安排并实现/);
  assert.match(updated, /意图：新/);
  assert.equal(mergePairDraft("我先写了一句", pack, "auto", previous), null);
  assert.match(mergePairDraft("我先写了一句", pack, "manual"), /我先写了一句/);
  assert.equal(mergePairDraft("", pack, "auto"), pack);
  assert.equal(stripUnsentPack(`${pack}\n先安排并实现`, pack), "先安排并实现");
  assert.equal(stripUnsentPack("我先写了一句", pack), "我先写了一句");
  const legacy = "【对席 old】\n旧\n【对席完】\n先安排并实现";
  assert.equal(stripUnsentPack(legacy), "先安排并实现");
  assert.match(mergePairDraft(legacy, pack, "auto"), /^意图：新/);
  assert.doesNotMatch(mergePairDraft(legacy, pack, "auto"), /对席/);
});

test("delivery is recorded only when that pack is actually sent", () => {
  const storage = memoryStorage();
  writePair("scope", {
    criticId: "a",
    workerId: "b",
    sentThrough: {},
    pending: { packId: "p9", sourceId: "a", targetId: "b", throughEntryId: "a2", text: "意图：问\n结论：答" },
  }, storage);

  commitPairDelivery("scope", "b", "我自己写的另一句", storage);
  assert.equal(readPair("scope", storage).pending.packId, "p9");
  assert.equal(readPair("scope", storage).sentThrough.a, undefined);

  commitPairDelivery("scope", "b", "意图：问\n结论：答\n执行一下", storage);
  const saved = readPair("scope", storage);
  assert.equal(saved.pending, null);
  assert.equal(saved.sentThrough.a, "a2");
});

test("a session row cycles master, slave, then clear, and replaces the previous seat", () => {
  let pair = cycleSeat(null, "a");
  assert.equal(seatOf(pair, "a"), "master");
  pair = cycleSeat(pair, "b");
  assert.equal(seatOf(pair, "b"), "master");
  assert.equal(seatOf(pair, "a"), null);
  pair = cycleSeat(pair, "b");
  assert.equal(seatOf(pair, "b"), "slave");
  pair = cycleSeat(pair, "a");
  pair = cycleSeat(pair, "a");
  assert.equal(seatOf(pair, "a"), "slave");
  assert.equal(seatOf(pair, "b"), null);
  assert.equal(cycleSeat(pair, "a"), null);
});
