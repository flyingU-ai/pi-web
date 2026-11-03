/** Per-admin private code roots. DatePool stays the shared data cwd. */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeWebAdmin, warehouseRoot } from "./web-admin-scope";

export type AdminWorkspaceMap = Record<string, string>;

function parseMap(raw: string): AdminWorkspaceMap {
  try {
    const doc = JSON.parse(raw) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
    const out: AdminWorkspaceMap = {};
    for (const [key, value] of Object.entries(doc)) {
      const admin = sanitizeWebAdmin(key);
      const root = String(value || "").trim();
      if (admin && root && !root.includes("pi-cwd")) out[admin] = resolve(root);
    }
    return out;
  } catch {
    return {};
  }
}

export function loadAdminWorkspaces(env: NodeJS.ProcessEnv = process.env): AdminWorkspaceMap {
  const fromEnv = String(env.PI_WEB_ADMIN_WORKSPACES || "").trim();
  if (fromEnv.startsWith("{")) {
    const parsed = parseMap(fromEnv);
    if (Object.keys(parsed).length) return parsed;
  }
  const candidates = [
    env.PI_WEB_ADMIN_WORKSPACES_FILE,
    env.PI_CODING_AGENT_DIR && `${env.PI_CODING_AGENT_DIR}/admin-workspaces.json`,
    warehouseRoot() && `${warehouseRoot()}/.agent/pi-web/admin-workspaces.json`,
  ].filter(Boolean) as string[];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const parsed = parseMap(readFileSync(file, "utf8"));
    if (Object.keys(parsed).length) return parsed;
  }
  return {};
}

export function resolveAdminCodeRoot(
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const name = sanitizeWebAdmin(admin);
  if (!name) return "";
  return loadAdminWorkspaces(env)[name] || "";
}
