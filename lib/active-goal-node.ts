/**
 * Server-only active-goal helpers. Imported by rpc-manager, never by client hooks.
 * No system injection: local pi-vllm has neither a goal pin nor a directory card.
 * `@path` stays in the user prompt; bash cwd is term-ws so relative `code/` resolves.
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  ACTIVE_GOAL_EXTENSION_NAME,
} from "./active-goal";

export {
  ACTIVE_GOAL_EXTENSION_NAME,
  countUserTurns,
  listDirectoryMentions,
  pinActiveGoal,
  shouldForkForNewTask,
} from "./active-goal";

/** Kept so callers compile; directory cards are not injected. */
export function expandDirectoryMentions(
  _prompt: string,
  _cwd: string,
  _options: { maxEntries?: number } = {},
): string {
  return "";
}

export function composeActiveGoalSystem(options: {
  systemPrompt: string;
  prompt: string;
  cwd?: string;
  priorUserTurns: number;
}): string {
  return String(options.systemPrompt || "");
}

function userTurnsFromSession(ctx: { sessionManager?: { getEntries?: () => unknown[] } } | undefined): number {
  try {
    const entries = ctx?.sessionManager?.getEntries?.() ?? [];
    return entries.filter((entry) => {
      const row = entry as { type?: string; message?: { role?: string } };
      return row?.type === "message" && row.message?.role === "user";
    }).length;
  } catch {
    return 0;
  }
}

export function createActiveGoalExtension(cwd = ""): InlineExtension {
  return {
    name: ACTIVE_GOAL_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event, ctx) => {
        const prior = userTurnsFromSession(ctx);
        const prompt = event.messageType === "user" ? event.prompt : "";
        const systemPrompt = composeActiveGoalSystem({
          systemPrompt: event.systemPrompt || "",
          prompt,
          cwd,
          priorUserTurns: prior,
        });
        if (systemPrompt === (event.systemPrompt || "")) return undefined;
        return { systemPrompt };
      });
    },
  };
}
