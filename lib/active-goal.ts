/**
 * Web-only host pin: sticky Chat must not close a new user turn with an
 * earlier git/commit topic. Local `pi-vllm -p --no-session` never has this
 * problem. Keep the added text short — this is not a second AGENTS.md.
 *
 * This file is imported by client hooks. Do not import node: builtins here.
 */

export const ACTIVE_GOAL_EXTENSION_NAME = "agentsmark-active-goal";

export const ACTIVE_GOAL_NOTE = [
  "<active_goal>",
  "本回合唯一交付目标是下面这条用户消息。更早的 git/commit/push 或其它已完成话题不得作为收口。未完成验收清单时不要提前结束。",
  "</active_goal>",
].join("\n");

const GIT_TOPIC = /\b(git\s+status|commit|push|pull|rebase|stash)\b|提交|推送/i;
const NEW_TASK_TOPIC =
  /分析|构建|训练集|class\s*bank|对比学习|taxonomy|映射|todo|评测|benchmark|采集/i;

export function countUserTurns(messages: Array<{ role?: string } | undefined> | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter((m) => m && m.role === "user").length;
}

export function pinActiveGoal(systemPrompt: string, priorUserTurns: number): string {
  const base = String(systemPrompt || "");
  if (priorUserTurns < 1) return base;
  if (base.includes("<active_goal>")) return base;
  return base ? `${base}\n\n${ACTIVE_GOAL_NOTE}` : ACTIVE_GOAL_NOTE;
}

/** First-user git/commit vs a later analysis/build message → start a fresh session. */
export function shouldForkForNewTask(firstUser: string, nextUser: string): boolean {
  const first = String(firstUser || "").trim();
  const next = String(nextUser || "").trim();
  if (!first || !next) return false;
  if (next.length < 40) return false;
  if (first === next) return false;
  const firstIsGit = GIT_TOPIC.test(first);
  const nextIsNew = NEW_TASK_TOPIC.test(next) && !GIT_TOPIC.test(next) && next.length >= 80;
  return firstIsGit && nextIsNew;
}

const MENTION_RE = /@([A-Za-z0-9._\-/\u4e00-\u9fff]+\/?)/g;

export function listDirectoryMentions(prompt: string): string[] {
  const found = new Set<string>();
  const text = String(prompt || "");
  for (const match of text.matchAll(MENTION_RE)) {
    const raw = String(match[1] || "").replace(/\/+$/, "");
    if (raw && !raw.includes("..")) found.add(raw);
  }
  return [...found];
}
