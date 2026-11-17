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
export const PAIR_MARK_END = "【对席完】";
export const NO_CONCLUSION = "这一轮没有单独的结论";

export interface SessionPairPending {
  packId: string;
  sourceId: string;
  targetId: string;
  throughEntryId: string;
}

export interface SessionPair {
  criticId: string;
  workerId: string;
  /** Entry id already delivered from each source. */
  sentThrough: Record<string, string | undefined>;
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
    if (!pair || !pair.criticId || !pair.workerId) return null;
    return {
      criticId: pair.criticId,
      workerId: pair.workerId,
      sentThrough: pair.sentThrough && typeof pair.sentThrough === "object" ? pair.sentThrough : {},
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
  if (pair.criticId === sessionId) return { id: pair.workerId, role: "worker" };
  if (pair.workerId === sessionId) return { id: pair.criticId, role: "critic" };
  return null;
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
export function packIntentConclusions(
  messages: readonly PairMessage[],
  entryIds: readonly string[],
  afterEntryId: string | undefined,
  sourceTitle: string,
  packId: string,
): PackedRounds {
  let start = 0;
  if (afterEntryId) {
    const cursor = entryIds.indexOf(afterEntryId);
    if (cursor >= 0) start = cursor + 1;
  }

  const rounds: string[] = [];
  let throughEntryId: string | null = null;
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const intent = visibleText(message.content);
    const span: PairMessage[] = [];
    let end = index;
    for (let next = index + 1; next < messages.length; next += 1) {
      if (messages[next].role === "user") break;
      span.push(messages[next]);
      end = next;
    }
    const conclusion = lastAssistantText(span) || NO_CONCLUSION;
    if (!intent && conclusion === NO_CONCLUSION) continue;
    rounds.push(`${rounds.length + 1}. 意图：${intent || "（这条没有文字）"}\n   结论：${conclusion}`);
    throughEntryId = entryIds[end] || entryIds[index] || throughEntryId;
  }

  const body = rounds.length > 0 ? rounds.join("\n") : "（没有新的意图和结论）";
  const text = `【对席 ${packId}】\n来自「${sourceTitle}」\n${body}\n${PAIR_MARK_END}\n`;
  return { packId, text, throughEntryId, rounds: rounds.length };
}

/** Keep anything the person already typed after the previous pack. */
export function replaceUnsentPack(existing: string, pack: string): string {
  const start = existing.indexOf("【对席 ");
  const stop = existing.indexOf(PAIR_MARK_END);
  if (start >= 0 && stop > start) {
    const suffix = existing.slice(stop + PAIR_MARK_END.length).replace(/^\n+/, "");
    return suffix ? `${pack}${suffix}` : pack;
  }
  return pack;
}

export function commitPairDelivery(scope: string, targetSessionId: string, sentText: string, storage: StorageLike | null): void {
  const pair = readPair(scope, storage);
  const pending = pair?.pending;
  if (!pair || !pending) return;
  if (pending.targetId !== targetSessionId) return;
  if (!sentText.includes(`【对席 ${pending.packId}】`)) return;
  pair.sentThrough = { ...pair.sentThrough, [pending.sourceId]: pending.throughEntryId };
  pair.pending = null;
  writePair(scope, pair, storage);
}
