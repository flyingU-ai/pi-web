/** DatePool stays the session cwd. Virtual `code/` is that admin's on-disk zone. */

import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  adminCodeHome,
  adminCodeZone,
  allAdminCodeRoots,
  CODE_ZONE_HOME,
  ensureAdminCodeZone,
  extraMountsFor,
} from "./admin-workspaces";
import { currentWebAdmin, sanitizeWebAdmin, warehouseRoot } from "./web-admin-scope";

export const VIRTUAL_CODE_DIR = "code";
export const VIRTUAL_CODE_HOME = CODE_ZONE_HOME;

export type VirtualCodeChild = { name: string; path: string };

export function adminCodeRoot(admin = currentWebAdmin()): string {
  return ensureAdminCodeZone(admin) ? adminCodeHome(admin) : "";
}

export function listVirtualCodeChildren(admin = currentWebAdmin()): VirtualCodeChild[] {
  const name = sanitizeWebAdmin(admin);
  if (!name) return [];
  const zone = ensureAdminCodeZone(name);
  const home = adminCodeHome(name);
  const out: VirtualCodeChild[] = [];
  if (home) out.push({ name: VIRTUAL_CODE_HOME, path: home });
  for (const mount of extraMountsFor(name)) {
    out.push({ name: mount.name, path: mount.path });
  }
  void zone;
  return out;
}

export function canMountVirtualCode(
  warehouse = warehouseRoot(),
  admin = currentWebAdmin(),
): boolean {
  if (!warehouse || !sanitizeWebAdmin(admin)) return false;
  return !existsSync(join(warehouse, VIRTUAL_CODE_DIR));
}

export function isVirtualCodeMount(
  target: string,
  admin = currentWebAdmin(),
): boolean {
  const warehouse = warehouseRoot();
  if (!canMountVirtualCode(warehouse, admin)) return false;
  return resolve(String(target || "")) === resolve(join(warehouse, VIRTUAL_CODE_DIR));
}

export function resolveDualRootPath(
  target: string,
  admin = currentWebAdmin(),
): string {
  const warehouse = warehouseRoot();
  if (!canMountVirtualCode(warehouse, admin)) return target;
  const zone = ensureAdminCodeZone(admin);
  if (!zone) return target;
  const prefix = resolve(join(warehouse, VIRTUAL_CODE_DIR));
  const abs = resolve(String(target || ""));
  if (abs === prefix) return zone;
  if (!abs.startsWith(prefix + sep)) return abs;
  return join(zone, abs.slice(prefix.length + 1));
}

/** `git -C` needs a directory. Start at the file so nested repos under `code/` resolve. */
export function gitCwdForPath(target: string, admin = currentWebAdmin()): string {
  let resolved = resolveDualRootPath(target, admin);
  for (;;) {
    try {
      if (statSync(resolved).isDirectory()) return resolved;
    } catch {
      // deleted / untracked — keep walking up
    }
    const parent = dirname(resolved);
    if (parent === resolved) return resolved;
    resolved = parent;
  }
}

export function virtualCodeDisplayPath(realPath: string, admin = currentWebAdmin()): string {
  const warehouse = warehouseRoot();
  if (!warehouse) return realPath;
  const abs = resolve(realPath);
  const zone = adminCodeZone(admin);
  if (zone) {
    const root = resolve(zone);
    if (abs === root) return join(warehouse, VIRTUAL_CODE_DIR);
    if (abs.startsWith(root + sep)) {
      return join(warehouse, VIRTUAL_CODE_DIR, abs.slice(root.length + 1));
    }
  }
  for (const child of listVirtualCodeChildren(admin)) {
    const root = resolve(child.path);
    if (abs === root) return join(warehouse, VIRTUAL_CODE_DIR, child.name);
    if (abs.startsWith(root + sep)) {
      return join(warehouse, VIRTUAL_CODE_DIR, child.name, abs.slice(root.length + 1));
    }
  }
  return realPath;
}

function safeAdminDir(admin: string): string {
  return String(admin || "").replace(/[^A-Za-z0-9._-]/g, "_");
}

export function termWorkspacesRoot(): string {
  // Prefer a host-local disk. DatePool NFS is only the fallback when lab
  // did not export PI_WEB_TERM_WS_ROOT (default /home/aoi/session-private/term-ws).
  if (process.env.PI_WEB_TERM_WS_ROOT) return process.env.PI_WEB_TERM_WS_ROOT;
  const warehouse = warehouseRoot();
  if (warehouse) return join(warehouse, ".agent", "term-ws");
  return join(homedir(), ".pi", "agent", "term-ws");
}

export function terminalWorkspaceRoot(admin = currentWebAdmin()): string {
  const name = safeAdminDir(admin);
  if (!name) return "";
  return join(termWorkspacesRoot(), name);
}

export function isForeignTermWorkspace(cwd: string, admin = currentWebAdmin()): boolean {
  const base = termWorkspacesRoot();
  const mine = terminalWorkspaceRoot(admin);
  if (!base || !mine) return false;
  const abs = resolve(cwd);
  const root = resolve(base);
  if (abs !== root && !abs.startsWith(root + sep)) return false;
  const own = resolve(mine);
  return abs !== own && !abs.startsWith(own + sep);
}

function ensureSymlink(link: string, target: string): void {
  try {
    const current = lstatSync(link);
    if (current.isSymbolicLink() && readlinkSync(link) === target) return;
    rmSync(link, { recursive: true, force: true });
  } catch {
    // missing
  }
  symlinkSync(target, link);
}

export function ensureTerminalWorkspace(admin = currentWebAdmin()): string {
  const warehouse = warehouseRoot();
  const zone = ensureAdminCodeZone(admin);
  const ws = terminalWorkspaceRoot(admin);
  if (!ws || !warehouse || !zone) return "";
  mkdirSync(ws, { recursive: true });
  ensureSymlink(join(ws, "data"), resolve(warehouse));
  ensureSymlink(join(ws, VIRTUAL_CODE_DIR), resolve(zone));
  return ws;
}

export function resolveTerminalCwd(requestedCwd: string, admin = currentWebAdmin()): string {
  const warehouse = warehouseRoot();
  if (isForeignTermWorkspace(requestedCwd, admin)) return "";
  if (!warehouse || !canMountVirtualCode(warehouse, admin)) return requestedCwd;
  if (resolve(requestedCwd) !== resolve(warehouse)) return requestedCwd;
  return ensureTerminalWorkspace(admin) || requestedCwd;
}

/** DatePool bash starts in term-ws so relative `code/` follows the admin zone. */
export function resolveAgentBashCwd(requestedCwd: string, admin = currentWebAdmin()): string {
  return resolveTerminalCwd(requestedCwd, admin) || requestedCwd;
}

/** Map virtual `$池/code/...` strings onto the on-disk admin zone. */
export function rewriteVirtualCodeText(text: string, admin = currentWebAdmin()): string {
  const warehouse = warehouseRoot();
  if (!warehouse || !text || !canMountVirtualCode(warehouse, admin)) return text;
  const zone = adminCodeZone(admin);
  if (!zone) return text;
  const prefix = resolve(join(warehouse, VIRTUAL_CODE_DIR));
  return text.split(prefix).join(resolve(zone));
}

export function adminWritableRoots(admin = currentWebAdmin()): string[] {
  return allAdminCodeRoots(admin);
}

export { adminCodeHome, adminCodeZone };
