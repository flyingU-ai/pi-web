/**
 * Remembers which tool-call cards the user has expanded, keyed by toolCallId.
 *
 * A streaming assistant message is rendered from `streamState`, then re-rendered
 * from `messages` after `message_end`, and re-keyed again once `entryIds` arrive
 * from the session file. Each of those hops remounts `ToolCallBlock`, so plain
 * component state would collapse a card the user just opened. Keeping the set
 * outside React lets the remounted card start expanded without threading state
 * through every message component.
 */
const expandedToolCalls = new Set<string>();

export function isToolCallExpanded(toolCallId: string | undefined): boolean {
  return toolCallId !== undefined && expandedToolCalls.has(toolCallId);
}

export function setToolCallExpanded(toolCallId: string | undefined, expanded: boolean): void {
  if (!toolCallId) return;
  if (expanded) expandedToolCalls.add(toolCallId);
  else expandedToolCalls.delete(toolCallId);
}

export function clearExpandedToolCalls(): void {
  expandedToolCalls.clear();
}

/** page_accept / page-*.png|json must stay open so the user sees what the agent read. */
export function isPageReceiptTool(block: {
  toolName?: string;
  input?: unknown;
  arguments?: unknown;
}): boolean {
  const blob = `${block.toolName || ""}\n${JSON.stringify(block.input ?? block.arguments ?? {})}`;
  return /\bpage_accept\.mjs\b/.test(blob)
    || /page-(?:distribution|benchmark)\.(?:png|json)/.test(blob);
}
