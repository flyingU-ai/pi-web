/**
 * DatePool Chat isolation: one pi-web process, sessions per admin.
 * Shared `$池/.agent/pi-web` stays models / AGENTS / skills.
 * JSONL lives on the host disk: `PI_WEB_SESSIONS_ROOT/<admin>/pi`,
 * falling back to `$池/.agent/sessions/<admin>/pi`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { resolve as resolvePath, sep } from "node:path";

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

export function adminFromRequest(req: Request): string {
  const header = sanitizeWebAdmin(req.headers.get(WEB_ADMIN_HEADER) || "");
  const cookie = sanitizeWebAdmin(cookieValue(req.headers.get("cookie") || "", WEB_ADMIN_COOKIE));
  return header || cookie;
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
  const name = sanitizeWebAdmin(admin) || NO_ADMIN_LEAF;
  return resolvePath(sessionsStoreRoot(warehouse), name, "pi");
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
    const fromCookie = sanitizeWebAdmin(
      (cookieStore as { get?: (n: string) => { value?: string } | undefined }).get?.(WEB_ADMIN_COOKIE)?.value || "",
    );
    return fromHeader || fromCookie;
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
