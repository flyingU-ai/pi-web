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

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** The whole scope → ids map, for syncing to the shared per-admin store. */
export function readPinsMap(storage: StorageLike | null): Record<string, string[]> {
  if (!storage) return {};
  try {
    const out: Record<string, string[]> = {};
    for (const [scope, ids] of Object.entries(readMap(storage))) {
      const clean = cleanIds(ids);
      if (scope && clean.length) out[scope] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

export function writePinsMap(map: Record<string, string[]>, storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable
  }
}

/** Remote wins for the scopes it knows; scopes only this browser has are kept. */
export function mergePinMaps(
  local: Record<string, string[]>,
  remote: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...local };
  for (const [scope, ids] of Object.entries(remote)) {
    const clean = cleanIds(ids);
    if (scope && clean.length) out[scope] = clean;
  }
  return out;
}
