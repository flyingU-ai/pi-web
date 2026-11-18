/**
 * Cross-login path gate for bash / read / write / edit.
 * The session login decides. This is not a timeout wall and is not a system prompt.
 */

import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { isAbsolute, join, resolve, sep } from "node:path";
import { isBlockedAdminLeaf } from "./admin-leaf";
import {
  adminCodeZone,
  codeZonesRoot,
  extraMountsFor,
  isForeignAdminCodePath,
  legacyCodeHomesRoot,
  loadAdminExtraMounts,
} from "./admin-workspaces";
import { isForeignTermWorkspace, rewriteVirtualCodeText } from "./dual-roots";
import { sanitizeWebAdmin, warehouseRoot } from "./web-admin-scope";

const HYF_ROOT = "/home/aoi/hyf";
const FOREIGN = "路径属于其他登录名的代码区，这次不能读也不能写。";
const HYF_WRITE = "这个 /home/aoi/hyf 目录没有登记给当前登录名，不能写入。私有文件放 code/home。";
const PRIVATE = "这个路径属于会话或密钥目录，只能访问当前登录名自己的那一份。";

export type AdminPathAction = "read" | "write";

function warehouseOf(env: NodeJS.ProcessEnv): string {
  const data = String(env.ANNOTATION_WORKSPACE_ROOT || env.PI_WEB_OPEN_FOLDER || "").trim();
  if (data) return resolve(data);
  return warehouseRoot();
}

/** Map `$池/code/...` onto this login's zone without creating directories. */
export function lexicalAdminCodePath(
  target: string,
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const warehouse = warehouseOf(env);
  const abs = resolve(target);
  if (!warehouse) return abs;
  const prefix = resolve(join(warehouse, "code"));
  const zone = adminCodeZone(admin, env);
  if (!zone) return abs;
  if (abs === prefix) return zone;
  if (abs.startsWith(prefix + sep)) return join(zone, abs.slice(prefix.length + 1));
  return abs;
}

function underTree(target: string, root: string): boolean {
  if (!root) return false;
  const abs = resolve(target);
  const base = resolve(root);
  return abs === base || abs.startsWith(base + sep);
}

function unregisteredHyfWrite(target: string, admin: string, env: NodeJS.ProcessEnv): boolean {
  if (!underTree(target, HYF_ROOT)) return false;
  const name = sanitizeWebAdmin(admin);
  if (!name) return true;
  return !extraMountsFor(name, env).some((mount) => underTree(target, mount.path));
}

function sessionsRoot(env: NodeJS.ProcessEnv): string {
  const explicit = String(env.PI_WEB_SESSIONS_ROOT || "").trim();
  if (explicit) return resolve(explicit);
  const warehouse = warehouseOf(env);
  return warehouse ? resolve(warehouse, ".agent", "sessions") : "/home/aoi/session-private";
}

function baseName(target: string): string {
  const slash = target.lastIndexOf("/");
  return slash >= 0 ? target.slice(slash + 1) : target;
}

/** Session files stay in the current leaf. Machine secrets are not readable. */
function privatePathBlock(target: string, admin: string, env: NodeJS.ProcessEnv): string | null {
  const abs = resolve(target);
  const base = baseName(abs);
  if (base === "provider-runtime-secrets.json" || base === ".ticket-secret") return PRIVATE;
  const root = sessionsRoot(env);
  if (!root || !underTree(abs, root)) return null;
  if (!admin || isBlockedAdminLeaf(admin)) return PRIVATE;
  const mine = resolve(join(root, admin));
  if (underTree(abs, mine)) return null;
  return PRIVATE;
}

export function adminPathBlockReason(
  target: string,
  admin: string,
  action: AdminPathAction,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = String(target || "").trim();
  if (!raw) return null;
  const name = sanitizeWebAdmin(admin);
  const abs = isAbsolute(raw) ? lexicalAdminCodePath(raw, name, env) : raw;
  if (isAbsolute(raw)) {
    const blocked = privatePathBlock(abs, name, env);
    if (blocked) return blocked;
    if (isForeignAdminCodePath(abs, name, env) || isForeignTermWorkspace(abs, name)) return FOREIGN;
    if (action === "write" && unregisteredHyfWrite(abs, name, env)) return HYF_WRITE;
  }
  return null;
}

function scanPrefix(text: string, prefix: string): string[] {
  const found: string[] = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(prefix, from);
    if (at < 0) break;
    let end = at + prefix.length;
    while (end < text.length && !/[\s"'`;|&<>()]/.test(text[end])) end += 1;
    const raw = text.slice(at, end).replace(/[.,:]+$/, "");
    if (raw.length > prefix.length || raw === prefix) found.push(raw);
    from = Math.max(end, at + prefix.length);
  }
  return found;
}

export function sensitiveCommandPaths(command: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const prefixes = [HYF_ROOT, sessionsRoot(env), codeZonesRoot(env), legacyCodeHomesRoot(env)];
  const warehouse = warehouseOf(env);
  if (warehouse) prefixes.push(join(warehouse, "code"));
  for (const mounts of Object.values(loadAdminExtraMounts(env))) {
    for (const mount of mounts) prefixes.push(mount.path);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const prefix of prefixes) {
    if (!prefix) continue;
    for (const path of scanPrefix(command, prefix)) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

function lastToken(command: string): string {
  const tokens = command.split(/\s+/).filter(Boolean);
  return (tokens[tokens.length - 1] || "").replace(/^['"]|['"]$/g, "");
}

function isWriteDestination(command: string, raw: string): boolean {
  const idx = command.indexOf(raw);
  if (idx < 0) return false;
  const before = command.slice(Math.max(0, idx - 120), idx);
  if (/(?:>>?)\s*['"]?$/.test(before)) return true;
  if (/\b(?:mkdir|rm|touch|tee|install|chmod|chown|truncate)\b[^&|;]*$/.test(before)) return true;
  if (/open\s*\(\s*['"]$/.test(before)) {
    const after = command.slice(idx + raw.length, idx + raw.length + 16);
    if (/['"]\s*,\s*['"][wa+]/.test(after)) return true;
  }
  if (/\b(?:cp|mv|rsync)\b/.test(command)) {
    const dest = lastToken(command);
    return dest === raw || dest.startsWith(`${raw}/`);
  }
  return false;
}

export function bashCommandBlockReason(
  command: string,
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const name = sanitizeWebAdmin(admin);
  const rewritten = rewriteVirtualCodeText(command, name);
  if (rewritten.includes("provider-runtime-secrets.json")) return PRIVATE;
  for (const raw of sensitiveCommandPaths(rewritten, env)) {
    const abs = lexicalAdminCodePath(raw, name, env);
    const blocked = privatePathBlock(resolve(raw), name, env) || privatePathBlock(abs, name, env);
    if (blocked) return blocked;
    if (isForeignAdminCodePath(abs, name, env) || isForeignTermWorkspace(abs, name)) return FOREIGN;
    if (isWriteDestination(rewritten, raw) && unregisteredHyfWrite(resolve(raw), name, env)) return HYF_WRITE;
  }
  return null;
}

type ToolInput = { command?: string; path?: string };

export function gateToolInput(
  toolName: string,
  input: ToolInput,
  admin: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const name = sanitizeWebAdmin(admin);
  if (toolName === "bash" || toolName === "powershell") {
    const command = rewriteVirtualCodeText(String(input.command || ""), name);
    input.command = command;
    return bashCommandBlockReason(command, name, env);
  }
  const write = toolName === "write" || toolName === "edit";
  if (!write && toolName !== "read" && toolName !== "ls" && toolName !== "grep" && toolName !== "find") {
    return null;
  }
  const raw = String(input.path || "");
  if (raw && isAbsolute(raw)) {
    const mapped = lexicalAdminCodePath(raw, name, env);
    if (mapped !== resolve(raw)) input.path = mapped;
    return adminPathBlockReason(input.path || raw, name, write ? "write" : "read", env);
  }
  return adminPathBlockReason(raw, name, write ? "write" : "read", env);
}

export const ADMIN_PATH_GATE_EXTENSION = "pi-web-admin-path-gate";

export function createAdminPathGateExtension(options: { admin?: string } = {}): InlineExtension {
  return {
    name: ADMIN_PATH_GATE_EXTENSION,
    hidden: true,
    factory: (pi) => {
      pi.on("tool_call", (event) => {
        const admin = sanitizeWebAdmin(options.admin || "") || undefined;
        const input = event.input as ToolInput;
        const reason = gateToolInput(event.toolName, input, admin || "", process.env);
        if (!reason) return undefined;
        return { block: true, reason };
      });
    },
  };
}
