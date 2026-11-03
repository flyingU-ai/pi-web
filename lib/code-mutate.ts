/** Mutate only the current admin's private code root. DatePool stays read-only here. */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { adminCodeHome, adminCodeZone, allAdminCodeRoots, extraMountsFor } from "./admin-workspaces";
import { isVirtualCodeMount, resolveDualRootPath, VIRTUAL_CODE_HOME } from "./dual-roots";
import { denyCrossAdminPath, getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { hasParentDirectorySegment } from "./path-security";

export const CODE_MUTATE_ACTIONS = ["mkdir", "create-file", "rename", "move", "delete", "merge"] as const;
export type CodeMutateAction = (typeof CODE_MUTATE_ACTIONS)[number];

const BLOCKED_NAMES = new Set(["", ".", "..", ".git"]);

export function sanitizeEntryName(name: string): string | null {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (BLOCKED_NAMES.has(trimmed)) return null;
  if (/[\\/\0]/.test(trimmed) || trimmed.includes("..")) return null;
  return trimmed;
}

function pathEqualsOrUnder(target: string, root: string, allowRoot: boolean): boolean {
  if (!root) return false;
  const abs = resolve(target);
  const base = resolve(root);
  if (abs === base) return allowRoot;
  return abs.startsWith(base + sep);
}

export function isInsideCodeRoot(target: string, admin: string, allowRoot = false): boolean {
  const home = adminCodeHome(admin);
  if (pathEqualsOrUnder(target, home, allowRoot)) return true;
  const zone = adminCodeZone(admin);
  if (allowRoot && zone && resolve(target) === resolve(zone)) return true;
  for (const mount of extraMountsFor(admin)) {
    if (pathEqualsOrUnder(target, mount.path, allowRoot)) return true;
    if (zone && pathEqualsOrUnder(target, join(zone, mount.name), allowRoot)) return true;
  }
  return false;
}

function requestedCodePath(requested: string, admin: string): string {
  if (isVirtualCodeMount(requested, admin)) {
    return join(requested, VIRTUAL_CODE_HOME);
  }
  return requested;
}

async function authorize(
  requested: string,
  admin: string,
  opts: { mustExist?: boolean; allowRoot?: boolean } = {},
): Promise<{ ok: true; path: string } | { ok: false; status: number; error: string }> {
  if (!requested || hasParentDirectorySegment(requested)) {
    return { ok: false, status: 400, error: "Invalid path" };
  }
  const resolved = resolveDualRootPath(requestedCodePath(requested, admin), admin);
  if (denyCrossAdminPath(resolved, admin) || denyCrossAdminPath(requested, admin)) {
    return { ok: false, status: 403, error: "Access denied" };
  }
  if (!isInsideCodeRoot(resolved, admin, opts.allowRoot ?? true)) {
    return { ok: false, status: 403, error: "Only the private code zone can be edited" };
  }
  const roots = await getAllowedFileRoots();
  for (const root of allAdminCodeRoots(admin)) roots.add(root);
  if (!isFilePathAllowed(resolved, roots)) {
    return { ok: false, status: 403, error: "Access denied" };
  }
  if (opts.mustExist !== false) {
    if (!existsSync(resolved)) return { ok: false, status: 404, error: "Not found" };
    if (!isExistingFilePathAllowed(resolved, roots)) {
      return { ok: false, status: 403, error: "Access denied" };
    }
  }
  return { ok: true, path: resolved };
}

function mergeDirectory(source: string, dest: string): { moved: number; skipped: number } {
  mkdirSync(dest, { recursive: true });
  let moved = 0;
  let skipped = 0;
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    const to = join(dest, name);
    if (!existsSync(to)) {
      renameSync(from, to);
      moved += 1;
      continue;
    }
    const fromDir = statSync(from).isDirectory();
    const toDir = statSync(to).isDirectory();
    if (fromDir && toDir) {
      const inner = mergeDirectory(from, to);
      moved += inner.moved;
      skipped += inner.skipped;
      continue;
    }
    skipped += 1;
  }
  if (readdirSync(source).length === 0) rmSync(source, { recursive: true, force: true });
  return { moved, skipped };
}

export async function mutateCodeEntry(
  admin: string,
  requestedPath: string,
  body: { action?: unknown; name?: unknown; to?: unknown; content?: unknown },
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const action = String(body.action || "");
  if (!(CODE_MUTATE_ACTIONS as readonly string[]).includes(action)) {
    return { status: 400, payload: { error: "Unknown action" } };
  }

  if (action === "mkdir" || action === "create-file") {
    const name = sanitizeEntryName(String(body.name || ""));
    if (!name) return { status: 400, payload: { error: "Invalid name" } };
    const parent = await authorize(requestedPath, admin, { allowRoot: true });
    if (!parent.ok) return { status: parent.status, payload: { error: parent.error } };
    if (!statSync(parent.path).isDirectory()) {
      return { status: 400, payload: { error: "Parent is not a directory" } };
    }
    const dest = join(parent.path, name);
    if (!isInsideCodeRoot(dest, admin, true)) {
      return { status: 403, payload: { error: "Only the private code zone can be edited" } };
    }
    if (existsSync(dest)) return { status: 409, payload: { error: "Already exists" } };
    if (action === "mkdir") mkdirSync(dest);
    else writeFileSync(dest, typeof body.content === "string" ? body.content : "", { flag: "wx" });
    return { status: 200, payload: { ok: true, action, path: dest, name } };
  }

  const source = await authorize(requestedPath, admin, { allowRoot: action !== "delete" });
  if (!source.ok) return { status: source.status, payload: { error: source.error } };
  if (action === "delete" && !isInsideCodeRoot(source.path, admin, false)) {
    return { status: 403, payload: { error: "Cannot delete the code root" } };
  }

  if (action === "delete") {
    rmSync(source.path, { recursive: true, force: true });
    return { status: 200, payload: { ok: true, action } };
  }

  if (action === "rename") {
    const name = sanitizeEntryName(String(body.name || ""));
    if (!name) return { status: 400, payload: { error: "Invalid name" } };
    const dest = join(dirname(source.path), name);
    if (!isInsideCodeRoot(dest, admin, false)) {
      return { status: 403, payload: { error: "Only the private code zone can be edited" } };
    }
    if (existsSync(dest)) return { status: 409, payload: { error: "Already exists" } };
    renameSync(source.path, dest);
    return { status: 200, payload: { ok: true, action, name } };
  }

  const destReq = String(body.to || "").trim();
  if (!destReq) return { status: 400, payload: { error: "Destination required" } };
  const destAuth = await authorize(destReq, admin, { allowRoot: true });
  if (!destAuth.ok) return { status: destAuth.status, payload: { error: destAuth.error } };
  if (!statSync(destAuth.path).isDirectory()) {
    return { status: 400, payload: { error: "Destination is not a directory" } };
  }

  if (action === "move") {
    const dest = join(destAuth.path, basename(source.path));
    if (dest === source.path) return { status: 400, payload: { error: "Already there" } };
    if (!isInsideCodeRoot(dest, admin, false)) {
      return { status: 403, payload: { error: "Only the private code zone can be edited" } };
    }
    if (existsSync(dest)) return { status: 409, payload: { error: "Already exists" } };
    if (dest.startsWith(source.path + sep)) {
      return { status: 400, payload: { error: "Cannot move a folder into itself" } };
    }
    renameSync(source.path, dest);
    return { status: 200, payload: { ok: true, action } };
  }

  if (!statSync(source.path).isDirectory()) {
    return { status: 400, payload: { error: "Merge needs a folder" } };
  }
  if (destAuth.path === source.path || destAuth.path.startsWith(source.path + sep)) {
    return { status: 400, payload: { error: "Cannot merge a folder into itself" } };
  }
  const stats = mergeDirectory(source.path, destAuth.path);
  return { status: 200, payload: { ok: true, action, ...stats } };
}
