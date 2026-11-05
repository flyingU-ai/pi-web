import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  countUserTurns,
  pinActiveGoal,
  shouldForkForNewTask,
  listDirectoryMentions,
  expandDirectoryMentions,
  composeActiveGoalSystem,
  createActiveGoalExtension,
} = await createJiti(import.meta.url).import("./active-goal-node.ts");

test("does not pin a host goal block on any turn", () => {
  assert.equal(pinActiveGoal("SYS", 0), "SYS");
  assert.equal(pinActiveGoal("SYS", 1), "SYS");
  assert.equal(pinActiveGoal("SYS", 2), "SYS");
});

test("git then analysis is a new task; short follow-up is not", () => {
  const git = "@code/promptDet/LitDeepFlow/ 分析一下git status我要进行commit给出建议";
  const analysis = "@code/promptDet/LitDeepFlow/ 参考这个算法仓库以及方法论，我现在想要对数据仓采集数据进行训练集的构建，对比学习+class bank，分析每个类应该有多少样本";
  assert.equal(shouldForkForNewTask(git, analysis), true);
  assert.equal(shouldForkForNewTask(git, "可以push"), false);
  assert.equal(shouldForkForNewTask(analysis, analysis), false);
});

test("@ mentions stay in the user prompt and do not become a system dir_card", () => {
  const root = mkdtempSync(join(tmpdir(), "dir-card-"));
  mkdirSync(join(root, "smt_benchmark"));
  writeFileSync(join(root, "smt_benchmark", "a.json"), "{}");
  writeFileSync(join(root, "smt_benchmark", "b.json"), "{}");
  assert.equal(expandDirectoryMentions("see @smt_benchmark/ please", root, { maxEntries: 40 }), "");
  assert.equal(listDirectoryMentions("see @smt_benchmark/ please").join(","), "smt_benchmark");
  assert.equal(listDirectoryMentions("x @foo/bar/ y @baz").join(","), "foo/bar,baz");
  assert.equal(listDirectoryMentions("@code/promptDet/LitDeepFlow/ 看这个仓").join(","), "code/promptDet/LitDeepFlow");
  assert.equal(composeActiveGoalSystem({
    systemPrompt: "SYS",
    prompt: "see @smt_benchmark/ please",
    cwd: root,
    priorUserTurns: 0,
  }), "SYS");
  rmSync(root, { recursive: true, force: true });
});

test("compose keeps system unchanged without mentions", () => {
  assert.equal(composeActiveGoalSystem({
    systemPrompt: "SYS",
    prompt: "hello",
    priorUserTurns: 0,
  }), "SYS");
});

test("extension keeps system unchanged even with a directory mention", () => {
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
  assert.equal(next, undefined);
  const mentioned = handlers.get("before_agent_start")({
    messageType: "user",
    prompt: "@code/promptDet/LitDeepFlow/ 看目录",
    systemPrompt: "SYS",
  }, prior);
  assert.equal(mentioned, undefined);
  assert.equal(countUserTurns([{ role: "user" }, { role: "assistant" }]), 1);
});
