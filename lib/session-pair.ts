/**
 * One pair of sessions in this browser. The host never sends the pack and
 * never writes it into the system prompt or MEMORY.md.
 */

const STORAGE_KEY = "pi-web:session-pair";
export const PAIR_CHANGE_EVENT = "pi-web:session-pair";

export function notifyPairChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PAIR_CHANGE_EVENT));
}
export const NO_CONCLUSION = "这一轮没有单独的结论";

export interface SessionPairPending {
  packId: string;
  sourceId: string;
  targetId: string;
  throughEntryId: string;
  /** Exact text last copied into the other input. Not shown as a wrapper. */
  text?: string;
}

export interface SessionPair {
  criticId: string;
  workerId: string;
  /** Entry id already delivered from each source. */
  sentThrough: Record<string, string | undefined>;
  /**
   * First pack only: user-message entry where packing starts. Missing means the
   * session start. Ignored once sentThrough is set for that source.
   */
  rangeStart?: Record<string, string | undefined>;
  /**
   * First pack only: inclusive last entry of that round. Missing means through
   * the latest round. Ignored once sentThrough is set for that source.
   */
  rangeEnd?: Record<string, string | undefined>;
  pending: SessionPairPending | null;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type TextBlock = { type: string; text?: string };

export interface PairMessage {
  role: string;
  content?: string | TextBlock[];
}

function readAll(storage: StorageLike): Record<string, SessionPair | undefined> {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, SessionPair | undefined>;
  } catch {
    return {};
  }
}

function writeAll(storage: StorageLike, map: Record<string, SessionPair | undefined>): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function readPair(scope: string, storage: StorageLike | null): SessionPair | null {
  if (!storage || !scope) return null;
  try {
    const pair = readAll(storage)[scope];
    if (!pair || (!pair.criticId && !pair.workerId)) return null;
    return {
      criticId: pair.criticId || "",
      workerId: pair.workerId || "",
      sentThrough: pair.sentThrough && typeof pair.sentThrough === "object" ? pair.sentThrough : {},
      rangeStart: pair.rangeStart && typeof pair.rangeStart === "object" ? pair.rangeStart : {},
      rangeEnd: pair.rangeEnd && typeof pair.rangeEnd === "object" ? pair.rangeEnd : {},
      pending: pair.pending ?? null,
    };
  } catch {
    return null;
  }
}

export function writePair(scope: string, pair: SessionPair | null, storage: StorageLike | null): void {
  if (!storage || !scope) return;
  try {
    const map = readAll(storage);
    if (!pair) delete map[scope];
    else map[scope] = pair;
    writeAll(storage, map);
  } catch {
    // storage unavailable
  }
}

export function otherSeat(pair: SessionPair, sessionId: string): { id: string; role: "critic" | "worker" } | null {
  if (pair.criticId === sessionId && pair.workerId) return { id: pair.workerId, role: "worker" };
  if (pair.workerId === sessionId && pair.criticId) return { id: pair.criticId, role: "critic" };
  return null;
}

export type PairSeatName = "master" | "slave";

/** Master is the seat that issues intent. Slave is the seat that carries it out. */
export function seatOf(pair: SessionPair | null, sessionId: string): PairSeatName | null {
  if (!pair || !sessionId) return null;
  if (pair.criticId === sessionId) return "master";
  if (pair.workerId === sessionId) return "slave";
  return null;
}

export function assignSeat(pair: SessionPair | null, sessionId: string, seat: PairSeatName | null): SessionPair | null {
  const next: SessionPair = {
    criticId: pair?.criticId === sessionId ? "" : (pair?.criticId || ""),
    workerId: pair?.workerId === sessionId ? "" : (pair?.workerId || ""),
    sentThrough: { ...(pair?.sentThrough || {}) },
    rangeStart: { ...(pair?.rangeStart || {}) },
    rangeEnd: { ...(pair?.rangeEnd || {}) },
    pending: pair?.pending && pair.pending.sourceId !== sessionId && pair.pending.targetId !== sessionId
      ? pair.pending
      : null,
  };
  if (seat === "master") next.criticId = sessionId;
  if (seat === "slave") next.workerId = sessionId;
  if (!next.criticId && !next.workerId) return null;
  return next;
}

/** Empty → master → slave → empty. A new master or slave replaces the previous one. */
export function cycleSeat(pair: SessionPair | null, sessionId: string): SessionPair | null {
  const current = seatOf(pair, sessionId);
  const next = current === null ? "master" : current === "master" ? "slave" : null;
  return assignSeat(pair, sessionId, next);
}

function visibleText(content: PairMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string" && block.text.trim())
    .map((block) => block.text!.trim())
    .join("\n")
    .trim();
}

function lastAssistantText(messages: PairMessage[]): string {
  let conclusion = "";
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const blocks = message.content.filter((block) => block.type === "text" && block.text?.trim());
    if (blocks.length > 0) conclusion = blocks[blocks.length - 1].text!.trim();
  }
  return conclusion;
}

export interface PackedRounds {
  packId: string;
  text: string;
  throughEntryId: string | null;
  rounds: number;
}

/** User text plus the last human-facing assistant sentence. Tool logs stay out. */
export interface UserTurn {
  userEntryId: string;
  throughEntryId: string;
  skipBeforeEntryId?: string;
  label: string;
}

/** One row per user message. The through id includes that round's conclusion. */
export function listUserTurns(messages: readonly PairMessage[], entryIds: readonly string[]): UserTurn[] {
  const turns: UserTurn[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].role !== "user") continue;
    let end = index;
    for (let next = index + 1; next < messages.length; next += 1) {
      if (messages[next].role === "user") break;
      end = next;
    }
    const userEntryId = entryIds[index] || "";
    const throughEntryId = entryIds[end] || userEntryId;
    if (!userEntryId || !throughEntryId) continue;
    const intent = visibleText(messages[index].content).replace(/\s+/g, " ");
    turns.push({
      userEntryId,
      throughEntryId,
      skipBeforeEntryId: index > 0 ? entryIds[index - 1] : undefined,
      label: intent.slice(0, 48) || "（这条没有文字）",
    });
  }
  return turns;
}

/**
 * Marks the person set in the transcript win. After a pack is sent those marks
 * are cleared, and the next pack continues from the cursor to the latest round.
 */
export function pairPackBounds(pair: SessionPair, sourceId: string): {
  delivered: boolean;
  after?: string;
  startUserId?: string;
  until?: string;
} {
  const startUserId = pair.rangeStart?.[sourceId];
  const until = pair.rangeEnd?.[sourceId];
  if (startUserId || until) return { delivered: false, startUserId, until };
  const delivered = pair.sentThrough?.[sourceId];
  if (delivered) return { delivered: true, after: delivered };
  return { delivered: false };
}

/**
 * Double-click chooses the pack. One cell selects that turn.
 * A second cell selects every turn between the two, including both.
 * Double-clicking a chosen cell again clears that cell.
 * The last cell that stayed chosen is the anchor for the next range.
 */
export function nextPairSelection(
  turns: readonly UserTurn[],
  startUserId: string | undefined,
  endThroughId: string | undefined,
  lastClickedUserId: string | undefined,
  clicked: UserTurn,
): { startUserId?: string; endThroughId?: string; lastClickedUserId?: string } {
  const indexOf = (userId: string | undefined) => turns.findIndex((turn) => turn.userEntryId === userId);
  const clickedIndex = indexOf(clicked.userEntryId);
  if (clickedIndex < 0) return { startUserId, endThroughId, lastClickedUserId };

  const startIndex = indexOf(startUserId);
  const endTurn = turns.find((turn) => turn.throughEntryId === endThroughId);
  const endIndex = endTurn ? indexOf(endTurn.userEntryId) : -1;
  const single = startIndex >= 0 && startIndex === endIndex;
  const hitsStart = startIndex >= 0 && startIndex === clickedIndex;
  const hitsEnd = endIndex >= 0 && endIndex === clickedIndex;

  if (hitsStart || hitsEnd) {
    if (single || (hitsStart && hitsEnd)) return {};
    const keep = turns[hitsStart ? endIndex : startIndex];
    return {
      startUserId: keep.userEntryId,
      endThroughId: keep.throughEntryId,
      lastClickedUserId: keep.userEntryId,
    };
  }

  const hasSelection = startIndex >= 0 || endIndex >= 0;
  const remembered = indexOf(lastClickedUserId);
  const anchor = hasSelection
    ? (remembered >= 0 ? remembered : (endIndex >= 0 ? endIndex : startIndex))
    : -1;
  if (anchor < 0) {
    return {
      startUserId: clicked.userEntryId,
      endThroughId: clicked.throughEntryId,
      lastClickedUserId: clicked.userEntryId,
    };
  }
  const low = Math.min(anchor, clickedIndex);
  const high = Math.max(anchor, clickedIndex);
  return {
    startUserId: turns[low].userEntryId,
    endThroughId: turns[high].throughEntryId,
    lastClickedUserId: clicked.userEntryId,
  };
}

export function packIntentConclusions(
  messages: readonly PairMessage[],
  entryIds: readonly string[],
  afterEntryId: string | undefined,
  sourceTitle: string,
  packId: string,
  untilEntryId?: string,
): PackedRounds {
  let start = 0;
  if (afterEntryId) {
    const cursor = entryIds.indexOf(afterEntryId);
    if (cursor >= 0) start = cursor + 1;
  }
  const untilIndex = untilEntryId ? entryIds.indexOf(untilEntryId) : -1;

  const rounds: string[] = [];
  let throughEntryId: string | null = null;
  for (let index = start; index < messages.length; index += 1) {
    if (untilIndex >= 0 && index > untilIndex) break;
    const message = messages[index];
    if (message.role !== "user") continue;
    const intent = visibleText(message.content);
    const span: PairMessage[] = [];
    let end = index;
    for (let next = index + 1; next < messages.length; next += 1) {
      if (untilIndex >= 0 && next > untilIndex) break;
      if (messages[next].role === "user") break;
      span.push(messages[next]);
      end = next;
    }
    const conclusion = lastAssistantText(span) || NO_CONCLUSION;
    if (!intent && conclusion === NO_CONCLUSION) continue;
    rounds.push(`意图：${intent || "（这条没有文字）"}\n结论：${conclusion}`);
    throughEntryId = entryIds[end] || entryIds[index] || throughEntryId;
  }

  void sourceTitle;
  const text = rounds.join("\n\n");
  return { packId, text, throughEntryId, rounds: rounds.length };
}

const LEGACY_PACK_END = "【对席完】";

function legacyPackSuffix(existing: string): string | null {
  const start = existing.indexOf("【对席 ");
  const stop = existing.indexOf(LEGACY_PACK_END);
  if (start < 0 || stop <= start) return null;
  return existing.slice(stop + LEGACY_PACK_END.length).replace(/^\n+/, "");
}

/** Keep anything the person already typed after the previous copy. */
export function replaceUnsentPack(existing: string, pack: string, previous?: string): string {
  const legacy = legacyPackSuffix(existing);
  if (legacy !== null) return legacy ? `${pack}\n${legacy}` : pack;
  const needle = previous?.trim();
  if (needle) {
    const at = existing.indexOf(needle);
    if (at >= 0) {
      const suffix = existing.slice(at + needle.length).replace(/^\n+/, "");
      const prefix = existing.slice(0, at).replace(/\n+$/, "");
      const head = prefix ? `${prefix}\n` : "";
      return suffix ? `${head}${pack}\n${suffix}` : `${head}${pack}`;
    }
  }
  return pack;
}

/**
 * Put a copy into a draft.
 * A previous copy is replaced. Text the person already typed stays after it.
 * An automatic update leaves a draft alone when it cannot find the previous copy.
 * Returns null when an automatic update should not write.
 */
export function mergePairDraft(existing: string, pack: string, mode: "manual" | "auto", previous?: string): string | null {
  const needle = previous?.trim();
  if (legacyPackSuffix(existing) !== null || (needle && existing.includes(needle))) {
    return replaceUnsentPack(existing, pack, previous);
  }
  if (!existing.trim()) return pack;
  if (mode === "auto") return null;
  return `${pack}\n${existing.replace(/^\n+/, "")}`;
}

/** Drop the unsent copy. Text the person typed after it stays. */
export function stripUnsentPack(existing: string, previous?: string): string {
  const legacy = legacyPackSuffix(existing);
  if (legacy !== null) return legacy;
  const needle = previous?.trim();
  if (!needle) return existing;
  const at = existing.indexOf(needle);
  if (at < 0) return existing;
  const suffix = existing.slice(at + needle.length).replace(/^\n+/, "");
  const prefix = existing.slice(0, at).replace(/\n+$/, "");
  if (prefix && suffix) return `${prefix}\n${suffix}`;
  return prefix || suffix;
}

export function commitPairDelivery(scope: string, targetSessionId: string, sentText: string, storage: StorageLike | null): void {
  const pair = readPair(scope, storage);
  const pending = pair?.pending;
  if (!pair || !pending) return;
  if (pending.targetId !== targetSessionId) return;
  const copied = pending.text?.trim();
  if (!copied || !sentText.includes(copied)) return;
  pair.sentThrough = { ...pair.sentThrough, [pending.sourceId]: pending.throughEntryId };
  pair.rangeStart = { ...pair.rangeStart, [pending.sourceId]: undefined };
  pair.rangeEnd = { ...pair.rangeEnd, [pending.sourceId]: undefined };
  pair.pending = null;
  writePair(scope, pair, storage);
}
