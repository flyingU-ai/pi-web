/**
 * Server-only active-goal helpers. Imported by rpc-manager, never by client hooks.
 */
import { readdirSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  ACTIVE_GOAL_EXTENSION_NAME,
  listDirectoryMentions,
} from "./active-goal";

export {
  ACTIVE_GOAL_EXTENSION_NAME,
  countUserTurns,
  listDirectoryMentions,
  pinActiveGoal,
  shouldForkForNewTask,
} from "./active-goal";

export function expandDirectoryMentions(
  prompt: string,
  cwd: string,
  options: { maxEntries?: number } = {},
): string {
  const maxEntries = Math.max(1, options.maxEntries ?? 40);
  const cards: string[] = [];
  for (const rel of listDirectoryMentions(prompt)) {
    const abs = resolvePath(String(cwd || "."), rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let names: string[] = [];
    try {
      names = readdirSync(abs).slice(0, maxEntries);
    } catch {
      continue;
    }
    const more = names.length >= maxEntries ? "\n…" : "";
    cards.push(`<dir_card path="${rel}">\n${names.join("\n")}${more}\n</dir_card>`);
  }
  return cards.join("\n");
}

export function composeActiveGoalSystem(options: {
  systemPrompt: string;
  prompt: string;
  cwd?: string;
  priorUserTurns: number;
}): string {
  let next = String(options.systemPrompt || "");
  const cards = expandDirectoryMentions(options.prompt, options.cwd || "");
  if (cards && !next.includes("<dir_card ")) {
    next = next ? `${next}\n\n${cards}` : cards;
  }
  return next;
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
