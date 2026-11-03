/** DatePool stays the session cwd. Admin code mounts as a virtual `code/` child. */

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { resolveAdminCodeRoot } from "./admin-workspaces";
import { currentWebAdmin, warehouseRoot } from "./web-admin-scope";

export const VIRTUAL_CODE_DIR = "code";

export function adminCodeRoot(admin = currentWebAdmin()): string {
  return resolveAdminCodeRoot(admin);
}

export function canMountVirtualCode(
  warehouse = warehouseRoot(),
  admin = currentWebAdmin(),
): boolean {
  const codeRoot = resolveAdminCodeRoot(admin);
  if (!warehouse || !codeRoot || !existsSync(codeRoot)) return false;
  return !existsSync(join(warehouse, VIRTUAL_CODE_DIR));
}

export function resolveDualRootPath(
  target: string,
  admin = currentWebAdmin(),
): string {
  const warehouse = warehouseRoot();
  if (!canMountVirtualCode(warehouse, admin)) return target;
  const prefix = resolve(join(warehouse, VIRTUAL_CODE_DIR));
  const abs = resolve(String(target || ""));
  const codeRoot = resolve(resolveAdminCodeRoot(admin));
  if (abs === prefix) return codeRoot;
  if (abs.startsWith(prefix + sep)) return join(codeRoot, abs.slice(prefix.length + 1));
  return abs;
}

/** `git -C` needs a directory. Start at the file so nested repos under `code/` resolve. */
export function gitCwdForPath(target: string, admin = currentWebAdmin()): string {
  const resolved = resolveDualRootPath(target, admin);
  try {
    if (statSync(resolved).isDirectory()) return resolved;
  } catch {
    // deleted / untracked path — still start from its parent
  }
  return dirname(resolved);
}

export function virtualCodeDisplayPath(realPath: string, admin = currentWebAdmin()): string {
  const warehouse = warehouseRoot();
  const codeRoot = adminCodeRoot(admin);
  if (!warehouse || !codeRoot) return realPath;
  const abs = resolve(realPath);
  const root = resolve(codeRoot);
  if (abs === root) return join(warehouse, VIRTUAL_CODE_DIR);
  if (abs.startsWith(root + sep)) return join(warehouse, VIRTUAL_CODE_DIR, abs.slice(root.length + 1));
  return realPath;
}
