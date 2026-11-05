import type { AgentPhase } from "@/hooks/useAgentSession";

/** Occupancy hint while idle. Waiting-for-model still reports from 25%. */
export const STICKY_CONTEXT_HINT_PERCENT = 70;

/** The i18n translate function shape this module needs. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export type PhaseLabelHint = {
  isCompacting?: boolean;
  bashRunning?: boolean;
  llamaDown?: boolean;
  contextPercent?: number | null;
};

/**
 * The status line shown while the agent is working.
 *
 * `isCompacting` takes precedence over the phase: auto-compaction can hold a turn for a
 * while before the next token arrives, and reporting the underlying "waiting for model"
 * phase in the meantime reads as a hang. Compaction is what the user needs to know.
 *
 * waiting_model is first-token wait (prefill/decode), not GGUF load. Be honest:
 * bash still running, llama down, fat context, otherwise "Working".
 */
export function phaseLabel(
  phase: AgentPhase,
  t: Translate,
  isCompactingOrHint?: boolean | PhaseLabelHint,
): string | null {
  const hint: PhaseLabelHint = typeof isCompactingOrHint === "object" && isCompactingOrHint
    ? isCompactingOrHint
    : { isCompacting: Boolean(isCompactingOrHint) };
  if (hint.isCompacting) return t("chat.compacting");
  if (hint.bashRunning && (!phase || phase.kind === "waiting_model")) {
    return t("chat.runningCommand");
  }
  if (phase?.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (latest?.progress) {
      return `${t("chat.runningNamedTool", { name: latest.name })} ${latest.progress}`;
    }
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return t("chat.runningTool");
    if (names.length === 1) return t("chat.runningNamedTool", { name: names[0] });
    if (names.length <= 3) return t("chat.runningTools", { names: names.join(", ") });
    return t("chat.runningToolsMore", { names: names.slice(0, 2).join(", "), count: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") {
    if (hint.llamaDown) return t("chat.waitingModelDown");
    const raw = hint.contextPercent;
    const pct = typeof raw === "number" && Number.isFinite(raw)
      ? (raw <= 1 ? raw * 100 : raw)
      : null;
    if (typeof pct === "number" && pct >= 25) {
      return t("chat.waitingPrefill", { percent: Math.round(pct) });
    }
    return t("chat.waitingGenerate");
  }
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  return null;
}
