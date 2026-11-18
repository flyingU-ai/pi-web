/**
 * DatePool Chat isolation: one pi-web process, sessions per admin.
 * Shared `$池/.agent/pi-web` stays models / AGENTS / skills.
 * JSONL lives on the host disk: `PI_WEB_SESSIONS_ROOT/<admin>/pi`,
 * falling back to `$池/.agent/sessions/<admin>/pi`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import { isBlockedAdminLeaf } from "./admin-leaf";
import { ticketSecret, verifyAdminCookie } from "./admin-ticket";

export const WEB_ADMIN_COOKIE = "aoi_admin";
export const WEB_ADMIN_HEADER = "x-aoi-admin";
export const NO_ADMIN_LEAF = "_no_admin";

const adminAls = new AsyncLocalStorage<string>();

export function sanitizeWebAdmin(admin: string): string {
  const name = String(admin || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 80);
  if (!name || name === "." || name === "..") return "";
  return name;
}

export function warehouseRoot(): string {
  const data = String(process.env.ANNOTATION_WORKSPACE_ROOT || "").trim();
  if (data) return resolvePath(data);
  const folder = String(process.env.PI_WEB_OPEN_FOLDER || "").trim();
  return folder ? resolvePath(folder) : "";
}

/**
 * Isolation is "this process serves more than one person", not "a DatePool
 * folder is open". Opening a warehouse must not turn on the login wall.
 */
export function multiUserMode(): boolean {
  return Boolean(
    String(process.env.PI_WEB_SESSIONS_ROOT || "").trim()
    || String(process.env.PI_WEB_TICKET_SECRET || "").trim()
    || String(process.env.PI_WEB_TICKET_SECRET_FILE || "").trim(),
  );
}

export function currentWebAdmin(): string {
  return sanitizeWebAdmin(adminAls.getStore() || "");
}

export function cookieValue(header: string, name: string): string {
  const prefix = `${name}=`;
  for (const part of String(header || "").split(";")) {
    const s = part.trim();
    if (s.startsWith(prefix)) {
      try {
        return decodeURIComponent(s.slice(prefix.length));
      } catch {
        return s.slice(prefix.length);
      }
    }
  }
  return "";
}

/** Lab start exports a ticket secret. Unsigned `aoi_admin=<leaf>` is then rejected. */
export function adminCookieIsSigned(): boolean {
  return Boolean(
    String(process.env.PI_WEB_TICKET_SECRET || "").trim()
    || String(process.env.PI_WEB_TICKET_SECRET_FILE || "").trim(),
  );
}

/** Leaf inside the login cookie. Empty when a required signature is missing or forged. */
export function leafFromAdminCookie(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!adminCookieIsSigned()) return sanitizeWebAdmin(value);
  return verifyAdminCookie(value, ticketSecret());
}

/**
 * The httpOnly cookie is the login. A request header or `?admin=` cannot
 * choose a leaf. A header that names someone else fails closed.
 */
export function adminFromRequest(req: Request): string {
  const header = sanitizeWebAdmin(req.headers.get(WEB_ADMIN_HEADER) || "");
  const cookie = leafFromAdminCookie(cookieValue(req.headers.get("cookie") || "", WEB_ADMIN_COOKIE));
  if (!cookie || isBlockedAdminLeaf(cookie)) return "";
  if (header && header !== cookie) return "";
  try {
    const query = sanitizeWebAdmin(new URL(req.url).searchParams.get("admin") || "");
    if (query && query !== cookie) return "";
  } catch {
    // Requests without an absolute URL still have the cookie.
  }
  return cookie;
}

export function withWebAdmin<T>(req: Request, fn: () => T): T {
  return adminAls.run(adminFromRequest(req), fn);
}

export function runWithWebAdmin<T>(admin: string, fn: () => T): T {
  return adminAls.run(sanitizeWebAdmin(admin), fn);
}

export function sessionsStoreRoot(warehouse = warehouseRoot()): string {
  const explicit = String(process.env.PI_WEB_SESSIONS_ROOT || "").trim();
  if (explicit) return resolvePath(explicit);
  return resolvePath(warehouse || "", ".agent", "sessions");
}

export function scopedSessionsDir(admin: string, warehouse = warehouseRoot()): string {
  const name = sanitizeWebAdmin(admin);
  const leaf = !name || isBlockedAdminLeaf(name) ? NO_ADMIN_LEAF : name;
  return resolvePath(sessionsStoreRoot(warehouse), leaf, "pi");
}

/** Admin leaf of `PI_WEB_SESSIONS_ROOT/<admin>/pi/<file>`. Empty when the file is elsewhere. */
export function adminFromSessionFile(sessionFile: string, warehouse = warehouseRoot()): string {
  const file = String(sessionFile || "").trim();
  if (!file) return "";
  const rel = relative(resolvePath(sessionsStoreRoot(warehouse)), resolvePath(file));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return "";
  const [admin, leaf] = rel.split(sep);
  if (leaf !== "pi") return "";
  return sanitizeWebAdmin(admin);
}

/** SSH keys and plan alarms. Not a file-tree root. */
export function isHostPrivateAdminPath(target: string, warehouse = warehouseRoot()): boolean {
  const file = String(target || "").trim();
  if (!file) return false;
  const rel = relative(resolvePath(sessionsStoreRoot(warehouse)), resolvePath(file));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
  const parts = rel.split(sep);
  return parts[1] === "ssh" || parts[1] === "alarms";
}

/** Per-admin provider keys. Empty when there is no warehouse identity (tests / CLI-like). */
export function scopedAuthPath(admin: string, warehouse = warehouseRoot()): string {
  const name = sanitizeWebAdmin(admin);
  if (!warehouse || !name || isBlockedAdminLeaf(name)) return "";
  return resolvePath(sessionsStoreRoot(warehouse), name, "auth.json");
}

/** Sync: ALS admin, or `_no_admin` when the warehouse is set. Tests without a warehouse stay undefined. */
export function resolveWebSessionDir(): string | undefined {
  const root = warehouseRoot();
  if (!root) return undefined;
  return scopedSessionsDir(currentWebAdmin() || NO_ADMIN_LEAF, root);
}

export async function resolveCurrentAdminAsync(): Promise<string> {
  return sanitizeWebAdmin(currentWebAdmin() || (await adminFromNextHeaders()));
}

async function adminFromNextHeaders(): Promise<string> {
  try {
    const mod = await import("next/headers");
    const headerStore = await Promise.resolve(mod.headers());
    const cookieStore = await Promise.resolve(mod.cookies());
    const fromHeader = sanitizeWebAdmin(
      (headerStore as { get?: (n: string) => string | null }).get?.(WEB_ADMIN_HEADER) || "",
    );
    const fromCookie = leafFromAdminCookie(
      (cookieStore as { get?: (n: string) => { value?: string } | undefined }).get?.(WEB_ADMIN_COOKIE)?.value || "",
    );
    if (fromHeader && fromHeader !== fromCookie) return "";
    return fromCookie;
  } catch {
    return "";
  }
}

export async function resolveWebSessionDirAsync(): Promise<string | undefined> {
  const root = warehouseRoot();
  if (!root) return undefined;
  const admin = currentWebAdmin() || (await adminFromNextHeaders());
  return scopedSessionsDir(admin || NO_ADMIN_LEAF, root);
}

export function fileIsUnder(filePath: string, rootDir: string): boolean {
  const file = resolvePath(filePath);
  const root = resolvePath(rootDir);
  return file === root || file.startsWith(root + sep);
}
