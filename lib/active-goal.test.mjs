import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  ACTIVE_GOAL_NOTE,
  countUserTurns,
  pinActiveGoal,
  shouldForkForNewTask,
  listDirectoryMentions,
  expandDirectoryMentions,
  composeActiveGoalSystem,
  createActiveGoalExtension,
} = await createJiti(import.meta.url).import("./active-goal-node.ts");

test("pins only after the first user turn", () => {
  assert.equal(pinActiveGoal("SYS", 0), "SYS");
  const pinned = pinActiveGoal("SYS", 1);
  assert.match(pinned, /<active_goal>/);
  assert.equal(pinActiveGoal(pinned, 2), pinned);
});

test("git then analysis is a new task; short follow-up is not", () => {
  const git = "@code/promptDet/LitDeepFlow/ 分析一下git status我要进行commit给出建议";
  const analysis = "@code/promptDet/LitDeepFlow/ 参考这个算法仓库以及方法论，我现在想要对数据仓采集数据进行训练集的构建，对比学习+class bank，分析每个类应该有多少样本";
  assert.equal(shouldForkForNewTask(git, analysis), true);
  assert.equal(shouldForkForNewTask(git, "可以push"), false);
  assert.equal(shouldForkForNewTask(analysis, analysis), false);
});

test("directory cards are one level and capped", () => {
  const root = mkdtempSync(join(tmpdir(), "dir-card-"));
  mkdirSync(join(root, "smt_benchmark"));
  writeFileSync(join(root, "smt_benchmark", "a.json"), "{}");
  writeFileSync(join(root, "smt_benchmark", "b.json"), "{}");
  const cards = expandDirectoryMentions("see @smt_benchmark/ please", root, { maxEntries: 40 });
  assert.match(cards, /<dir_card path="smt_benchmark">/);
  assert.match(cards, /a\.json/);
  assert.equal(listDirectoryMentions("x @foo/bar/ y @baz").join(","), "foo/bar,baz");
  rmSync(root, { recursive: true, force: true });
});

test("compose keeps first-turn system unchanged without mentions", () => {
  assert.equal(composeActiveGoalSystem({
    systemPrompt: "SYS",
    prompt: "hello",
    priorUserTurns: 0,
  }), "SYS");
});

test("extension appends active_goal on follow-up turns", () => {
  const handlers = new Map();
  const ext = createActiveGoalExtension("/tmp");
  ext.factory({ on: (name, fn) => handlers.set(name, fn) });
  const empty = { sessionManager: { getEntries: () => [] } };
  const prior = {
    sessionManager: {
      getEntries: () => [{ type: "message", message: { role: "user" } }],
    },
  };
  const first = handlers.get("before_agent_start")({
    messageType: "user",
    prompt: "git status",
    systemPrompt: "SYS",
  }, empty);
  assert.equal(first, undefined);
  const next = handlers.get("before_agent_start")({
    messageType: "user",
    prompt: "现在分析训练集",
    systemPrompt: "SYS",
  }, prior);
  assert.match(next.systemPrompt, /<active_goal>/);
  assert.match(ACTIVE_GOAL_NOTE, /不得作为收口/);
  assert.equal(countUserTurns([{ role: "user" }, { role: "assistant" }]), 1);
});
