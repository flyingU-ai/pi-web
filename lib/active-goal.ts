/**
 * Directory mention cards for Web Chat. Do not pin extra system text here —
 * local pi-vllm has no host-injected goal block.
 *
 * This file is imported by client hooks. Do not import node: builtins here.
 */

export const ACTIVE_GOAL_EXTENSION_NAME = "agentsmark-active-goal";

const GIT_TOPIC = /\b(git\s+status|commit|push|pull|rebase|stash)\b|提交|推送/i;
const NEW_TASK_TOPIC =
  /分析|构建|训练集|class\s*bank|对比学习|taxonomy|映射|todo|评测|benchmark|采集/i;

export function countUserTurns(messages: Array<{ role?: string } | undefined> | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter((m) => m && m.role === "user").length;
}

/** Kept as a no-op so callers stay aligned with local pi-vllm (no system pin). */
export function pinActiveGoal(systemPrompt: string, _priorUserTurns = 0): string {
  return String(systemPrompt || "");
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
