/** One on-disk tree per admin: `.agent/code/<admin>/{home, extra-symlinks}`. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join, resolve, sep } from "node:path";
import { sanitizeWebAdmin, warehouseRoot } from "./web-admin-scope";

export type ExtraMount = { name: string; path: string };
export type AdminWorkspaceMap = Record<string, string>;

const RESERVED_MOUNT_NAMES = new Set(["", ".", "..", "home", "code", "data"]);
export const CODE_ZONE_HOME = "home";

function warehouseFromEnv(env: NodeJS.ProcessEnv): string {
  const data = String(env.ANNOTATION_WORKSPACE_ROOT || env.PI_WEB_OPEN_FOLDER || "").trim();
  if (data) return resolve(data);
  return warehouseRoot();
}

/** SSOT parent: `$池/.agent/code`. */
export function codeZonesRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env.PI_WEB_CODE_ZONES_ROOT || env.PI_WEB_CODE_HOMES_ROOT || "").trim();
  if (explicit) return resolve(explicit);
  const warehouse = warehouseFromEnv(env);
  return warehouse ? join(warehouse, ".agent", "code") : "";
}

/** Legacy `$池/.agent/code-homes` — migrated into `code/<admin>/home`. */
export function legacyCodeHomesRoot(env: NodeJS.ProcessEnv = process.env): string {
  const warehouse = warehouseFromEnv(env);
  return warehouse ? join(warehouse, ".agent", "code-homes") : "";
}

/** Kept so lab checks still see the old leaf name while we migrate. */
export function codeHomesRoot(env: NodeJS.ProcessEnv = process.env): string {
  return legacyCodeHomesRoot(env);
}

export function adminCodeZone(
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const name = sanitizeWebAdmin(admin);
  const root = codeZonesRoot(env);
  if (!name || !root) return "";
  return join(root, name);
}

export function adminCodeHome(
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const zone = adminCodeZone(admin, env);
  return zone ? join(zone, CODE_ZONE_HOME) : "";
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

function migrateLegacyHome(admin: string, home: string, env: NodeJS.ProcessEnv): void {
  const name = sanitizeWebAdmin(admin);
  const legacy = join(legacyCodeHomesRoot(env), name);
  if (!name || !existsSync(legacy) || existsSync(home)) return;
  try {
    if (lstatSync(legacy).isDirectory()) {
      mkdirSync(dirnameSafe(home), { recursive: true });
      renameSync(legacy, home);
    }
  } catch {
    // leave legacy in place; home will be created empty
  }
}

function dirnameSafe(filePath: string): string {
  const idx = filePath.lastIndexOf(sep);
  return idx <= 0 ? filePath : filePath.slice(0, idx);
}

export function ensureAdminCodeHome(
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return ensureAdminCodeZone(admin, env) ? adminCodeHome(admin, env) : "";
}

export function ensureAdminCodeZone(
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const zone = adminCodeZone(admin, env);
  const home = adminCodeHome(admin, env);
  if (!zone || !home) return "";
  mkdirSync(zone, { recursive: true });
  migrateLegacyHome(admin, home, env);
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
    const readme = join(home, "README.md");
    if (!existsSync(readme)) {
      writeFileSync(
        readme,
        `# ${sanitizeWebAdmin(admin)} code home\n\nUpload or create files here. This directory is private to your login.\n`,
      );
    }
    try {
      execFileSync("git", ["init"], { cwd: home, stdio: "ignore" });
    } catch {
      // git is optional; upload/CRUD still work without a repo
    }
  }
  const extras = extraMountsFor(admin, env);
  const keep = new Set<string>([CODE_ZONE_HOME, ...extras.map((item) => item.name)]);
  for (const mount of extras) {
    ensureSymlink(join(zone, mount.name), resolve(mount.path));
  }
  try {
    for (const name of readdirSync(zone)) {
      if (keep.has(name)) continue;
      const abs = join(zone, name);
      try {
        if (lstatSync(abs).isSymbolicLink()) rmSync(abs, { force: true });
      } catch {
        // ignore
      }
    }
  } catch {
    // listing is best-effort
  }
  return zone;
}

function mountNameFromPath(abs: string, taken: Set<string>): string {
  const base = basename(abs).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
  let name = base && !RESERVED_MOUNT_NAMES.has(base) ? base : "repo";
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  let i = 2;
  while (taken.has(`${name}_${i}`)) i += 1;
  name = `${name}_${i}`;
  taken.add(name);
  return name;
}

function extraFromValue(
  value: unknown,
  taken: Set<string>,
  env: NodeJS.ProcessEnv,
): ExtraMount[] {
  const out: ExtraMount[] = [];
  const push = (nameHint: string, rawPath: string) => {
    const root = String(rawPath || "").trim();
    if (!root || root.includes("pi-cwd") || !root.startsWith("/")) return;
    const abs = resolve(root);
    if (!existsSync(abs)) return;
    const hint = String(nameHint || "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    const name = hint && !RESERVED_MOUNT_NAMES.has(hint) && !taken.has(hint)
      ? (taken.add(hint), hint)
      : mountNameFromPath(abs, taken);
    out.push({ name, path: abs });
  };
  if (typeof value === "string") {
    push("", value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") push("", item);
      else if (item && typeof item === "object" && "path" in item) {
        push(String((item as { name?: unknown }).name || ""), String((item as { path: unknown }).path));
      }
    }
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") push(key, item);
    }
  }
  void env;
  return out;
}

function parseExtraDoc(raw: string, env: NodeJS.ProcessEnv): Record<string, ExtraMount[]> {
  try {
    const doc = JSON.parse(raw) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
    const out: Record<string, ExtraMount[]> = {};
    for (const [key, value] of Object.entries(doc)) {
      const admin = sanitizeWebAdmin(key);
      if (!admin) continue;
      const taken = new Set<string>(RESERVED_MOUNT_NAMES);
      const mounts = extraFromValue(value, taken, env);
      if (mounts.length) out[admin] = mounts;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadAdminExtraMounts(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, ExtraMount[]> {
  const fromEnv = String(env.PI_WEB_ADMIN_WORKSPACES || "").trim();
  if (fromEnv.startsWith("{")) {
    const parsed = parseExtraDoc(fromEnv, env);
    if (Object.keys(parsed).length) return parsed;
  }
  const candidates = [
    env.PI_WEB_ADMIN_WORKSPACES_FILE,
    env.PI_CODING_AGENT_DIR && `${env.PI_CODING_AGENT_DIR}/admin-workspaces.json`,
    warehouseRoot() && `${warehouseRoot()}/.agent/pi-web/admin-workspaces.json`,
  ].filter(Boolean) as string[];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const parsed = parseExtraDoc(readFileSync(file, "utf8"), env);
    if (Object.keys(parsed).length) return parsed;
  }
  return {};
}

/** Legacy map: first extra path per admin. Personal homes are not listed here. */
export function loadAdminWorkspaces(env: NodeJS.ProcessEnv = process.env): AdminWorkspaceMap {
  const out: AdminWorkspaceMap = {};
  for (const [admin, mounts] of Object.entries(loadAdminExtraMounts(env))) {
    if (mounts[0]) out[admin] = mounts[0].path;
  }
  return out;
}

export function extraMountsFor(
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): ExtraMount[] {
  const name = sanitizeWebAdmin(admin);
  if (!name) return [];
  const zone = adminCodeZone(name, env);
  const home = adminCodeHome(name, env);
  const all = loadAdminExtraMounts(env);
  return (all[name] || []).filter((mount) => {
    if (home && (mount.path === home || mount.path.startsWith(home + sep))) return false;
    if (zone && (mount.path === zone || mount.path.startsWith(zone + sep))) return false;
    return !isForeignAdminCodePath(mount.path, name, env);
  });
}

export function allAdminCodeRoots(
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const zone = ensureAdminCodeZone(admin, env);
  const roots = new Set<string>();
  if (zone) roots.add(zone);
  const home = adminCodeHome(admin, env);
  if (home) roots.add(home);
  for (const mount of extraMountsFor(admin, env)) roots.add(mount.path);
  return [...roots];
}

/** Personal home. Extra repos are not the default root. */
export function resolveAdminCodeRoot(
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return adminCodeHome(admin, env);
}

function underTree(target: string, root: string): boolean {
  if (!root) return false;
  const abs = resolve(target);
  const base = resolve(root);
  return abs === base || abs.startsWith(base + sep);
}

export function isForeignAdminCodePath(
  target: string,
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const abs = resolve(String(target || ""));
  const name = sanitizeWebAdmin(admin);
  for (const parent of [codeZonesRoot(env), legacyCodeHomesRoot(env)]) {
    if (!parent) continue;
    const base = resolve(parent);
    if (abs === base || abs.startsWith(base + sep)) {
      if (!name) return true;
      const mine = resolve(join(base, name));
      return abs !== mine && !abs.startsWith(mine + sep);
    }
  }
  for (const [other, mounts] of Object.entries(loadAdminExtraMounts(env))) {
    if (other === name) continue;
    for (const mount of mounts) {
      if (underTree(abs, mount.path)) return true;
    }
  }
  return false;
}
