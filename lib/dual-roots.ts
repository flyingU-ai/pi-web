/** DatePool stays the session cwd. Admin code mounts as a virtual `code/` child. */

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  adminCodeHome,
  allAdminCodeRoots,
  ensureAdminCodeHome,
  extraMountsFor,
} from "./admin-workspaces";
import { currentWebAdmin, sanitizeWebAdmin, warehouseRoot } from "./web-admin-scope";

export const VIRTUAL_CODE_DIR = "code";
export const VIRTUAL_CODE_HOME = "home";

export type VirtualCodeChild = { name: string; path: string };

export function adminCodeRoot(admin = currentWebAdmin()): string {
  return ensureAdminCodeHome(admin);
}

export function listVirtualCodeChildren(admin = currentWebAdmin()): VirtualCodeChild[] {
  const name = sanitizeWebAdmin(admin);
  if (!name) return [];
  const home = ensureAdminCodeHome(name);
  const out: VirtualCodeChild[] = [];
  if (home) out.push({ name: VIRTUAL_CODE_HOME, path: home });
  for (const mount of extraMountsFor(name)) {
    out.push({ name: mount.name, path: mount.path });
  }
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
  const prefix = resolve(join(warehouse, VIRTUAL_CODE_DIR));
  const abs = resolve(String(target || ""));
  if (abs === prefix) return prefix;
  if (!abs.startsWith(prefix + sep)) return abs;
  const rest = abs.slice(prefix.length + 1);
  const [head, ...tail] = rest.split(sep);
  const match = listVirtualCodeChildren(admin).find((child) => child.name === head);
  if (!match) return abs;
  return tail.length ? join(match.path, ...tail) : match.path;
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
  if (process.env.PI_WEB_TERM_WS_ROOT) return process.env.PI_WEB_TERM_WS_ROOT;
  const warehouse = warehouseRoot();
  if (warehouse) return join(warehouse, ".agent", "term-ws");
  return join(homedir(), ".pi", "agent", "term-ws");
}

/** Per-admin terminal view: `data` → DatePool, `code/<name>` → that admin's mounts. */
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
  const children = listVirtualCodeChildren(admin);
  const ws = terminalWorkspaceRoot(admin);
  if (!ws || !warehouse || !children.length) return "";
  mkdirSync(ws, { recursive: true });
  const codeDir = join(ws, VIRTUAL_CODE_DIR);
  try {
    const current = lstatSync(codeDir);
    if (current.isSymbolicLink() || !current.isDirectory()) {
      rmSync(codeDir, { recursive: true, force: true });
    }
  } catch {
    // missing
  }
  mkdirSync(codeDir, { recursive: true });
  const keep = new Set(children.map((child) => child.name));
  try {
    for (const name of readdirSync(codeDir)) {
      if (!keep.has(name)) rmSync(join(codeDir, name), { recursive: true, force: true });
    }
  } catch {
    // listing is best-effort
  }
  ensureSymlink(join(ws, "data"), resolve(warehouse));
  for (const child of children) {
    ensureSymlink(join(codeDir, child.name), resolve(child.path));
  }
  return ws;
}

/** Workspace terminal at DatePool becomes the admin's data+code view. */
export function resolveTerminalCwd(requestedCwd: string, admin = currentWebAdmin()): string {
  const warehouse = warehouseRoot();
  if (isForeignTermWorkspace(requestedCwd, admin)) return "";
  if (!warehouse || !canMountVirtualCode(warehouse, admin)) return requestedCwd;
  if (resolve(requestedCwd) !== resolve(warehouse)) return requestedCwd;
  return ensureTerminalWorkspace(admin) || requestedCwd;
}

export function adminWritableRoots(admin = currentWebAdmin()): string[] {
  return allAdminCodeRoots(admin);
}

export { adminCodeHome };
