import { getAdditionalAllowedRoots, getAllowedRootsCacheMap, allowedRootsCacheKey, normalizeSlashes } from "./allowed-roots";
import { allAdminCodeRoots, isForeignAdminCodePath } from "./admin-workspaces";
import { isForeignTermWorkspace, terminalWorkspaceRoot } from "./dual-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { listAllSessions } from "./session-reader";
import { resolveCurrentAdminAsync, warehouseRoot } from "./web-admin-scope";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath } from "./paths";

const ALLOWED_ROOTS_TTL_MS = 5_000;

function isUsableRoot(target: string, admin: string): boolean {
  if (!target) return false;
  if (isForeignAdminCodePath(target, admin)) return false;
  if (isForeignTermWorkspace(target, admin)) return false;
  return true;
}

/** Warehouse contains every admin home; lexical-under-DatePool is not enough. */
export function denyCrossAdminPath(target: string, admin: string): boolean {
  return isForeignAdminCodePath(target, admin) || isForeignTermWorkspace(target, admin);
}

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const admin = await resolveCurrentAdminAsync();
  const cacheKey = allowedRootsCacheKey(admin);
  const cacheMap = getAllowedRootsCacheMap();
  const cached = cacheMap.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd && isUsableRoot(s.cwd, admin)) roots.add(normalizeSlashes(s.cwd));
    if (s.projectRoot && isUsableRoot(s.projectRoot, admin)) roots.add(normalizeSlashes(s.projectRoot));
  }

  const warehouse = warehouseRoot();
  if (warehouse) roots.add(normalizeSlashes(warehouse));

  for (const codeRoot of allAdminCodeRoots(admin)) {
    roots.add(normalizeSlashes(codeRoot));
  }

  const termWs = terminalWorkspaceRoot(admin);
  if (termWs) roots.add(normalizeSlashes(termWs));

  for (const root of getAdditionalAllowedRoots(admin)) {
    if (isUsableRoot(root, admin)) roots.add(root);
  }

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
