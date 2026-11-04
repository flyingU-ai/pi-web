// Bounded snapshot of one session's rendered view, so switching back
// to a recently visited session shows history immediately while a background
// freshness check runs.
//
// Constraints (deliberate):
// - Memory LRU plus a same-tab sessionStorage copy of *settled history only*.
//   Refresh can restore the last window; a new tab starts empty.
// - Never localStorage/IndexedDB/Service Worker, never sent to the model.
// - LRU: at most MAX_SESSIONS sessions and MAX_TOTAL_BYTES serialized bytes;
//   oversize or error snapshots are simply not cached.
// - Only *settled history* is cached: the confirmed message window, entry ids,
//   active leaf, pagination cursor, summary tree, and display stats. Never
//   streaming state, queued messages, run state, or SSE objects.

import type { AgentMessage } from "./types";

export interface SessionViewSnapshot {
	sessionId: string;
	/** Opaque server revision the snapshot was validated against. */
	revision: string;
	messages: AgentMessage[];
	entryIds: string[];
	leafId: string | null;
	/** Oldest entry id currently loaded — the pagination cursor. */
	oldestEntryId: string | null;
	hasMore: boolean;
	/** Summary-format branch tree (no bodies) when the server sent one. */
	summaryTree?: unknown;
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
	stats?: unknown;
	totalActiveMs?: number;
	/** Ids of history pages the user already paged in beyond the first window. */
	loadedEntryIds: string[];
	savedAt: number;
}

const MAX_SESSIONS = 8;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const TTL_MS = 10 * 60_000;
const PERSIST_KEY = "pi-web.session-view.v1";
const PERSIST_MAX_SESSIONS = 3;
const PERSIST_MAX_BYTES = 1_500_000;

declare global {
	var __piSessionViewCache: Map<string, SessionViewSnapshot> | undefined;
	var __piSessionViewCacheHydrated: boolean | undefined;
}

function persistStore(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
	try {
		const storage = globalThis.sessionStorage;
		if (!storage || typeof storage.getItem !== "function") return null;
		return storage;
	} catch {
		return null;
	}
}

function persistSnapshots(store: Map<string, SessionViewSnapshot>): void {
	const storage = persistStore();
	if (!storage) return;
	const entries: SessionViewSnapshot[] = [];
	let bytes = 2;
	for (const snapshot of [...store.values()].reverse()) {
		if (entries.length >= PERSIST_MAX_SESSIONS) break;
		if (Date.now() - snapshot.savedAt > TTL_MS) continue;
		const next = JSON.stringify(snapshot);
		if (bytes + next.length > PERSIST_MAX_BYTES) continue;
		entries.push(snapshot);
		bytes += next.length + 1;
	}
	try {
		if (entries.length === 0) storage.removeItem(PERSIST_KEY);
		else storage.setItem(PERSIST_KEY, JSON.stringify(entries.reverse()));
	} catch {
		/* quota / private mode */
	}
}

function hydrateFromSessionStorage(): Map<string, SessionViewSnapshot> {
	const store = new Map<string, SessionViewSnapshot>();
	const storage = persistStore();
	if (!storage) return store;
	try {
		const raw = storage.getItem(PERSIST_KEY);
		if (!raw) return store;
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return store;
		for (const item of parsed) {
			if (!item || typeof item !== "object") continue;
			const snapshot = item as SessionViewSnapshot;
			if (!snapshot.sessionId || !snapshot.revision) continue;
			if (typeof snapshot.savedAt !== "number") continue;
			if (Date.now() - snapshot.savedAt > TTL_MS) continue;
			store.set(snapshot.sessionId, snapshot);
		}
	} catch {
		try { persistStore()?.removeItem(PERSIST_KEY); } catch { /* ignore */ }
	}
	return store;
}

function cache(): Map<string, SessionViewSnapshot> {
	if (!globalThis.__piSessionViewCache) {
		globalThis.__piSessionViewCache = globalThis.__piSessionViewCacheHydrated
			? new Map()
			: hydrateFromSessionStorage();
		globalThis.__piSessionViewCacheHydrated = true;
	}
	return globalThis.__piSessionViewCache;
}

function snapshotBytes(snapshot: SessionViewSnapshot): number {
	try {
		return JSON.stringify(snapshot).length;
	} catch {
		// Circular or non-serializable payload — treat as oversize.
		return Number.MAX_SAFE_INTEGER;
	}
}

function evictToFit(): void {
	const store = cache();
	while (store.size > MAX_SESSIONS) {
		const oldestKey = store.keys().next().value;
		if (oldestKey === undefined) break;
		store.delete(oldestKey);
	}
	let total = 0;
	for (const snapshot of store.values()) total += snapshotBytes(snapshot);
	while (total > MAX_TOTAL_BYTES && store.size > 0) {
		const oldestKey = store.keys().next().value;
		if (oldestKey === undefined) break;
		const removed = store.get(oldestKey);
		store.delete(oldestKey);
		if (removed) total -= snapshotBytes(removed);
	}
}

export function getSessionViewSnapshot(sessionId: string): SessionViewSnapshot | null {
	const snapshot = cache().get(sessionId);
	if (!snapshot) return null;
	if (Date.now() - snapshot.savedAt > TTL_MS) {
		cache().delete(sessionId);
		return null;
	}
	// LRU touch.
	cache().delete(sessionId);
	cache().set(sessionId, snapshot);
	return snapshot;
}

/** Store a snapshot; returns false when it was refused (oversize/invalid). */
export function setSessionViewSnapshot(snapshot: Omit<SessionViewSnapshot, "savedAt">): boolean {
	if (!snapshot.sessionId || !snapshot.revision) return false;
	const store = cache();
	store.delete(snapshot.sessionId);
	const entry: SessionViewSnapshot = { ...snapshot, savedAt: Date.now() };
	const bytes = snapshotBytes(entry);
	if (bytes > MAX_TOTAL_BYTES) return false;
	store.set(entry.sessionId, entry);
	evictToFit();
	persistSnapshots(store);
	return cache().has(entry.sessionId);
}

export function deleteSessionViewSnapshot(sessionId: string): void {
	const store = cache();
	store.delete(sessionId);
	persistSnapshots(store);
}

export function clearSessionViewCache(): void {
	const store = cache();
	store.clear();
	persistSnapshots(store);
}

/** True when a cached window still covers every entry the UI has loaded. */
export function snapshotCoversLoadedEntries(
	snapshot: SessionViewSnapshot,
	loadedEntryIds: string[],
): boolean {
	if (loadedEntryIds.length === 0) return true;
	const known = new Set([...snapshot.entryIds, ...snapshot.loadedEntryIds]);
	return loadedEntryIds.every((id) => known.has(id));
}

/** Test seam: drop all module state. */
export function resetSessionViewCacheForTests(): void {
	globalThis.__piSessionViewCache = undefined;
	globalThis.__piSessionViewCacheHydrated = undefined;
}
