/**
 * Pinned sessions for one admin and workspace. Stored in this browser only.
 * Order is the order they were pinned; newly pinned ids go to the front.
 */

const STORAGE_KEY = "pi-web:pinned-sessions";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readMap(storage: StorageLike): Record<string, string[] | undefined> {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string[] | undefined>;
  } catch {
    return {};
  }
}

function writeIds(scope: string, ids: string[], storage: StorageLike): void {
  const map = readMap(storage);
  if (ids.length === 0) delete map[scope];
  else map[scope] = ids;
  storage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function pinnedSessionIds(scope: string, storage: StorageLike | null): string[] {
  if (!storage || !scope) return [];
  try {
    const ids = readMap(storage)[scope];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

export function pinSession(scope: string, sessionId: string, storage: StorageLike | null): string[] {
  if (!storage || !scope || !sessionId) return pinnedSessionIds(scope, storage);
  const next = [sessionId, ...pinnedSessionIds(scope, storage).filter((id) => id !== sessionId)];
  try {
    writeIds(scope, next, storage);
  } catch {
    // storage unavailable
  }
  return next;
}

export function unpinSession(scope: string, sessionId: string, storage: StorageLike | null): string[] {
  if (!storage || !scope || !sessionId) return pinnedSessionIds(scope, storage);
  const next = pinnedSessionIds(scope, storage).filter((id) => id !== sessionId);
  try {
    writeIds(scope, next, storage);
  } catch {
    // storage unavailable
  }
  return next;
}

/** Pinned families keep their pin order. Everyone else keeps the incoming order. */
export function orderByPins<T>(items: readonly T[], idOf: (item: T) => string, pins: readonly string[]): T[] {
  const rank = new Map(pins.map((id, index) => [id, index]));
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (rank.has(idOf(item))) pinned.push(item);
    else rest.push(item);
  }
  pinned.sort((a, b) => (rank.get(idOf(a)) ?? 0) - (rank.get(idOf(b)) ?? 0));
  return [...pinned, ...rest];
}
