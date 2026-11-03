import { toSlashPath } from "./paths";
import { currentWebAdmin, sanitizeWebAdmin } from "./web-admin-scope";

// In-memory roots that should be browsable in addition to roots derived from
// persisted sessions. Stored on globalThis so Next.js hot-reload keeps them.
declare global {
  var __piAllowedRootsCacheByAdmin:
    | Map<string, { roots: Set<string>; expiresAt: number }>
    | undefined;
  var __piAdditionalAllowedRootsByAdmin: Map<string, Set<string>> | undefined;
}

const SHARED_BUCKET = "_shared";

/**
 * Allowed roots are internal bookkeeping keys that are never displayed, so they
 * are stored slash-normalized for consistent Set membership. Correctness does
 * not depend on it — isPathWithinRoots() re-normalizes whatever it is given.
 */
export function normalizeSlashes(filePath: string): string {
  return toSlashPath(filePath);
}

function buckets(): Map<string, Set<string>> {
  if (!globalThis.__piAdditionalAllowedRootsByAdmin) {
    globalThis.__piAdditionalAllowedRootsByAdmin = new Map();
  }
  return globalThis.__piAdditionalAllowedRootsByAdmin;
}

function bucketFor(admin: string): Set<string> {
  const key = sanitizeWebAdmin(admin) || SHARED_BUCKET;
  const map = buckets();
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

export function getAdditionalAllowedRoots(admin = currentWebAdmin()): Set<string> {
  const out = new Set<string>();
  for (const root of bucketFor(SHARED_BUCKET)) out.add(root);
  const name = sanitizeWebAdmin(admin);
  if (name) {
    for (const root of bucketFor(name)) out.add(root);
  }
  return out;
}

export function allowFileRoot(root: string, admin = currentWebAdmin()): void {
  if (!root) return;
  const normalizedRoot = normalizeSlashes(root);
  bucketFor(admin).add(normalizedRoot);
  const cacheMap = globalThis.__piAllowedRootsCacheByAdmin;
  const cacheKey = sanitizeWebAdmin(admin) || SHARED_BUCKET;
  cacheMap?.get(cacheKey)?.roots.add(normalizedRoot);
  if (!sanitizeWebAdmin(admin)) {
    cacheMap?.get(SHARED_BUCKET)?.roots.add(normalizedRoot);
  }
}

export function allowedRootsCacheKey(admin: string): string {
  return sanitizeWebAdmin(admin) || SHARED_BUCKET;
}

export function getAllowedRootsCacheMap(): Map<string, { roots: Set<string>; expiresAt: number }> {
  if (!globalThis.__piAllowedRootsCacheByAdmin) {
    globalThis.__piAllowedRootsCacheByAdmin = new Map();
  }
  return globalThis.__piAllowedRootsCacheByAdmin;
}
