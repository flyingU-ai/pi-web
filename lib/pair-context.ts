import type { AgentMessage } from "./types";
import {
  listUserTurns,
  otherSeat,
  packIntentConclusions,
  pairPackBounds,
  type SessionPair,
} from "./session-pair";

export const PAIR_RANGE_SHORT = "PAIR_RANGE_SHORT";
const PACK_PAGE_LIMIT = 30;

interface LoadedContext {
  messages: AgentMessage[];
  entryIds: string[];
  hasMore: boolean;
  oldestEntryId: string | null;
}

async function fetchContextPage(sessionId: string, before?: string): Promise<LoadedContext> {
  const query = new URLSearchParams({ tail: "1000", deferThinking: "1" });
  if (before) query.set("before", before);
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context?${query}`);
  const data = await response.json() as {
    error?: string;
    context?: { messages?: AgentMessage[]; entryIds?: string[]; hasMore?: boolean; oldestEntryId?: string | null };
  };
  if (!response.ok || data.error) throw new Error(data.error || "session context failed");
  return {
    messages: data.context?.messages ?? [],
    entryIds: data.context?.entryIds ?? [],
    hasMore: Boolean(data.context?.hasMore && data.context.oldestEntryId),
    oldestEntryId: data.context?.oldestEntryId ?? null,
  };
}

async function loadForPack(sessionId: string, mustInclude: string | undefined, requireAll: boolean): Promise<LoadedContext> {
  let loaded = await fetchContextPage(sessionId);
  for (let page = 1; page < PACK_PAGE_LIMIT; page += 1) {
    const covered = !mustInclude || loaded.entryIds.includes(mustInclude);
    if (covered && (!requireAll || !loaded.hasMore)) return loaded;
    if (!loaded.hasMore || !loaded.oldestEntryId) break;
    const older = await fetchContextPage(sessionId, loaded.oldestEntryId);
    loaded = {
      messages: [...older.messages, ...loaded.messages],
      entryIds: [...older.entryIds, ...loaded.entryIds],
      hasMore: older.hasMore,
      oldestEntryId: older.oldestEntryId,
    };
  }
  const covered = !mustInclude || loaded.entryIds.includes(mustInclude);
  if (!covered || (requireAll && loaded.hasMore)) throw new Error(PAIR_RANGE_SHORT);
  return loaded;
}

export async function buildPairDraft(
  sessionId: string,
  pair: SessionPair,
  sourceTitle: string,
  packId = Math.random().toString(36).slice(2, 8),
): Promise<{ text: string; throughEntryId: string; packId: string; targetId: string } | null> {
  const seat = otherSeat(pair, sessionId);
  if (!seat) return null;
  const bounds = pairPackBounds(pair, sessionId);
  const requireAll = !bounds.delivered && !bounds.startUserId;
  const loaded = await loadForPack(
    sessionId,
    bounds.delivered ? bounds.after : bounds.startUserId,
    requireAll,
  );
  const startTurn = bounds.startUserId
    ? listUserTurns(loaded.messages, loaded.entryIds).find((turn) => turn.userEntryId === bounds.startUserId)
    : undefined;
  if (bounds.startUserId && !startTurn) throw new Error(PAIR_RANGE_SHORT);
  const packed = packIntentConclusions(
    loaded.messages,
    loaded.entryIds,
    bounds.delivered ? bounds.after : startTurn?.skipBeforeEntryId,
    sourceTitle,
    packId,
    bounds.delivered ? undefined : bounds.until,
  );
  if (!packed.throughEntryId || packed.rounds === 0) return null;
  return {
    text: packed.text,
    throughEntryId: packed.throughEntryId,
    packId,
    targetId: seat.id,
  };
}
