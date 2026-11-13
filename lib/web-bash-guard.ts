/** Fleet numbers and DatePool path classifiers. No bash/find deny hooks. */

export const FLEET_SLOT_CTX = 131072;
export const FLEET_MAX_TOKENS = 16384;

/** Model-asked wall timeout. Missing/invalid → no wall, same as local pi-vllm. */
export function resolveBashTimeout(timeout: unknown): number | undefined {
  const n = Number(timeout);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function poolRootFromEnv(): string {
  return String(
    process.env.ANNOTATION_WORKSPACE_ROOT || process.env.PI_WEB_OPEN_FOLDER || "",
  ).replace(/\/+$/, "");
}

export function isDatePoolRoot(absPath: string): boolean {
  const p = String(absPath || "").replace(/\/+$/, "");
  if (!p) return false;
  const envRoot = poolRootFromEnv();
  if (envRoot && p === envRoot) return true;
  if (/AgentSMarkDatePoolv2$/i.test(p)) return true;
  const base = p.split("/").pop() || "";
  if (/^DatePool$/i.test(base)) return true;
  return false;
}

export function isUnderPool(absPath: string): boolean {
  const p = String(absPath || "").replace(/\/+$/, "");
  const root = poolRootFromEnv();
  if (root && (p === root || p.startsWith(`${root}/`))) return true;
  if (isDatePoolRoot(p)) return true;
  return /AgentSMarkDatePoolv2(?:\/|$)/i.test(p) || /\/DatePool(?:\/|$)/i.test(p);
}

/** $池/cache and DatePool root: file-index lists one level, never walks. */
export function isPoolHeavyDir(absPath: string): boolean {
  const p = String(absPath || "").replace(/\/+$/, "");
  if (!p) return false;
  if (isDatePoolRoot(p)) return true;
  const base = p.split("/").pop() || "";
  if (base === "cache") {
    const parent = p.slice(0, Math.max(0, p.length - "/cache".length));
    if (isDatePoolRoot(parent) || isUnderPool(parent)) return true;
  }
  return false;
}

/** Streaming find/fd/rglob is not progress for an optional idle fuse. Not a deny. */
export function isWalkLikeCommand(command: string): boolean {
  const cmd = String(command || "").replace(/\s+/g, " ").trim();
  return /\bfind\b/.test(cmd)
    || /\bfd\b/.test(cmd)
    || /\brglob\s*\(/.test(cmd)
    || /\bos\.walk\s*\(/.test(cmd)
    || /\bPath\.glob\s*\(/.test(cmd)
    || /(?:^|[;&|]\s*)du\b/.test(cmd);
}
