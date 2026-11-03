import { getAdditionalAllowedRoots, getAllowedRootsCacheMap, allowedRootsCacheKey, normalizeSlashes } from "./allowed-roots";
import { resolveAdminCodeRoot } from "./admin-workspaces";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { listAllSessions } from "./session-reader";
import { resolveCurrentAdminAsync, warehouseRoot } from "./web-admin-scope";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath } from "./paths";

const ALLOWED_ROOTS_TTL_MS = 5_000;

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const legacy = (globalThis as { __piAllowedRootsCache?: { roots: Set<string>; expiresAt: number } })
    .__piAllowedRootsCache;
  if (legacy?.roots && legacy.expiresAt > now) return legacy.roots;

  const admin = await resolveCurrentAdminAsync();
  const cacheKey = allowedRootsCacheKey(admin);
  const cacheMap = getAllowedRootsCacheMap();
  const cached = cacheMap.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }

  const warehouse = warehouseRoot();
  if (warehouse) roots.add(normalizeSlashes(warehouse));

  const codeRoot = resolveAdminCodeRoot(admin);
  if (codeRoot) roots.add(normalizeSlashes(codeRoot));

  for (const root of getAdditionalAllowedRoots(admin)) roots.add(root);

  cacheMap.set(cacheKey, { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS });
  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots);
}
