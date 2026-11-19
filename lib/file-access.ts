import { realpathSync } from "node:fs";
import { getAdditionalAllowedRoots, getAllowedRootsCacheMap, allowedRootsCacheKey, normalizeSlashes } from "./allowed-roots";
import { allAdminCodeRoots, isForeignAdminCodePath } from "./admin-workspaces";
import { extraDataPoolRoots } from "./data-pools";
import { isForeignTermWorkspace, terminalWorkspaceRoot } from "./dual-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { isHostPrivateAdminPath, resolveCurrentAdminAsync, sanitizeWebAdmin, warehouseRoot } from "./web-admin-scope";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath } from "./paths";

const ALLOWED_ROOTS_TTL_MS = 5_000;

function rememberRoot(roots: Set<string>, target: string): void {
  if (!target) return;
  roots.add(normalizeSlashes(target));
  try {
    roots.add(normalizeSlashes(realpathSync(target)));
  } catch {
    // Extra mounts and homes may be missing until the zone is created.
  }
}

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

export async function getAllowedFileRoots(adminHint = ""): Promise<Set<string>> {
  const now = Date.now();
  const admin = sanitizeWebAdmin(adminHint) || await resolveCurrentAdminAsync();
  const cacheKey = allowedRootsCacheKey(admin);
  const cacheMap = getAllowedRootsCacheMap();
  const cached = cacheMap.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.roots;

  const roots = new Set<string>();
  const warehouse = warehouseRoot();
  if (warehouse) rememberRoot(roots, warehouse);
  for (const poolRoot of extraDataPoolRoots()) {
    rememberRoot(roots, poolRoot);
  }

  for (const codeRoot of allAdminCodeRoots(admin)) {
    rememberRoot(roots, codeRoot);
  }

  const termWs = terminalWorkspaceRoot(admin);
  if (termWs) rememberRoot(roots, termWs);

  for (const root of getAdditionalAllowedRoots(admin)) {
    if (isUsableRoot(root, admin)) rememberRoot(roots, root);
  }

  cacheMap.set(cacheKey, { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS });
  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  if (isHostPrivateAdminPath(target)) return false;
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  if (isHostPrivateAdminPath(target)) return false;
  if (!isExistingPathWithinRoots(target, allowedRoots)) return false;
  try {
    if (isHostPrivateAdminPath(realpathSync(target))) return false;
  } catch {
    // The lexical check already ran. A missing path is not a secret file.
  }
  return true;
}
