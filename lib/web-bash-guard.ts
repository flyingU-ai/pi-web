/** agentSMark-web harness: bash must match fleet truth and not walk DatePool. */

import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { resolve as resolvePath } from "node:path";

export const FLEET_SLOT_CTX = 131072;
export const FLEET_MAX_TOKENS = 65536;
/** Stall fuse: no stdout/stderr after first byte. Not a work-quota wall. */
export const BASH_IDLE_SECONDS = 120;
/** First-byte grace. Silent start is not idle until this elapses. */
export const BASH_START_GRACE_SECONDS = 180;
/** Process-safety ceiling only. Idle fuse is the real stop. */
export const BASH_WALL_FALLBACK_SECONDS = 86400;
/** Pool find/fd must stay this shallow. */
export const FIND_MAXDEPTH_MAX = 2;

/** Model-asked wall timeout. Missing/invalid → no requested wall. */
export function resolveBashTimeout(timeout: unknown): number | undefined {
  const n = Number(timeout);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function oneLine(command: string): string {
  return String(command || "").replace(/\s+/g, " ").trim();
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

/** $池/cache and DatePool root: NFS bombs; list one level, never walk. */
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

function isPoolRootPath(pathText: string, cwd: string): boolean {
  const p = pathText.replace(/['"]/g, "").replace(/\/+$/, "");
  if (!p || p === "." || p === cwd.replace(/\/+$/, "")) return true;
  if (isDatePoolRoot(p)) return true;
  if (/\/data$/.test(p) && /DatePool/i.test(p)) return true;
  return false;
}

function absFromCwd(target: string, cwd: string): string {
  const t = String(target || ".").replace(/['"]/g, "").trim() || ".";
  if (t.startsWith("/")) return resolvePath(t);
  return resolvePath(String(cwd || poolRootFromEnv() || "."), t);
}

function poolRelDepth(absPath: string): number {
  const p = String(absPath || "").replace(/\/+$/, "");
  const root = poolRootFromEnv();
  if (root && (p === root || p.startsWith(`${root}/`))) {
    const rel = p.slice(root.length).replace(/^\/+/, "");
    if (!rel) return 0;
    return rel.split("/").filter(Boolean).length;
  }
  const m = p.match(/AgentSMarkDatePoolv2\/(.+)$/i) || p.match(/\/DatePool\/(.+)$/i);
  if (m) return m[1].split("/").filter(Boolean).length;
  if (isDatePoolRoot(p)) return 0;
  return 99;
}

function isBareLs(cmd: string): boolean {
  return /^ls(?:\s+-[a-zA-Z0-9]+)*\s*$/.test(cmd)
    || /^ls(?:\s+-[a-zA-Z0-9]+)*\s+(?:\.|'\.'|"\.")\s*$/.test(cmd);
}

function findMaxdepth(cmd: string): number | null {
  const m = cmd.match(/-maxdepth\s+(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Strip -flag arg pairs so the first remaining token is the search root. */
function findTarget(cmd: string): string {
  const m = cmd.match(/\bfind\b\s*(.*)$/);
  if (!m) return ".";
  const stripped = m[1].replace(/-[A-Za-z][\w-]*\s+\S+/g, " ").trim();
  const tok = stripped.split(/\s+/).find((t) => t && !t.startsWith("-")) || ".";
  return tok.replace(/['"]/g, "") || ".";
}

export function isWalkLikeCommand(command: string): boolean {
  const cmd = oneLine(command);
  return /\bfind\b/.test(cmd)
    || /\bfd\b/.test(cmd)
    || /\brglob\s*\(/.test(cmd)
    || /\bos\.walk\s*\(/.test(cmd)
    || /\bPath\.glob\s*\(/.test(cmd)
    || /(?:^|[;&|]\s*)du\b/.test(cmd);
}

function denyFindClass(cmd: string, cwd: string): string | null {
  if (!/\bfind\b/.test(cmd)) return null;
  if (/(?:^|[;&|]\s*)find\s+\/(?:\s|$)/.test(cmd)) {
    return "BASH_DENIED: 禁止 find /（会打满 NFS）";
  }
  const depth = findMaxdepth(cmd);
  if (depth == null || depth > FIND_MAXDEPTH_MAX) {
    return `BASH_DENIED: find 必须带 -maxdepth 1 或 2；刷路径不算干活`;
  }
  const target = findTarget(cmd);
  const abs = absFromCwd(target, cwd);
  if (isPoolRootPath(target, cwd) || isDatePoolRoot(abs) || isPoolHeavyDir(abs)) {
    return "BASH_DENIED: 禁止 find 池根或 $池/cache；请 ls 用户 @ 的仓内子目录 | head";
  }
  return null;
}

function denyFdClass(cmd: string, cwd: string): string | null {
  if (!/\bfd\b/.test(cmd)) return null;
  if (isDatePoolRoot(cwd) || isUnderPool(cwd)) {
    return "BASH_DENIED: 禁止 fd 扫池；定点到仓内第二层或用 harvest";
  }
  return null;
}

/** Return a denial string, or null if the command may run. */
export function denyBashCommand(command: string, cwd = ""): string | null {
  const cmd = oneLine(command);
  if (!cmd) return "空命令已拒绝";

  if (/\bpage_accept\.mjs\b/.test(cmd)) {
    return null;
  }

  const findDenied = denyFindClass(cmd, cwd);
  if (findDenied) return findDenied;
  const fdDenied = denyFdClass(cmd, cwd);
  if (fdDenied) return fdDenied;

  if (/(?:^|[;&|]\s*)du\b/.test(cmd)) {
    return "BASH_DENIED: 禁止 du DatePool";
  }
  if (/\brglob\s*\(|os\.walk\s*\(|Path\.glob\s*\(/.test(cmd)) {
    return "BASH_DENIED: 禁止 rglob/os.walk 扫池；发现走 jsonl / harvest / sqlite";
  }
  if (isBareLs(cmd)) {
    return "BASH_DENIED: 禁止 ls 池根。请 ls 用户 @ 的子目录 | head（例如 ls smt_benchmark | head）";
  }
  const lsPath = cmd.match(/^ls(?:\s+-[a-zA-Z0-9]+)*\s+(\S+)\s*$/);
  if (lsPath && isPoolRootPath(lsPath[1], cwd)) {
    return "BASH_DENIED: 禁止 ls 池根。请进入用户 @ 的仓再列 | head";
  }
  if (/\bgrep\s+-[A-Za-z]*r[A-Za-z]*\b/.test(cmd)
    && /(\s\/\s|\s\/$|\s\.(\s|$))/.test(` ${cmd} `)) {
    return "BASH_DENIED: 禁止 grep -r 池根或 /";
  }
  if (/\bos\.listdir\s*\(/.test(cmd)
    && /(os\.listdir\s*\(\s*(DR|data|cwd|root|['\"]\.['\"]))/.test(cmd)) {
    return "BASH_DENIED: 禁止 os.listdir 池根；只打开用户点名的 Sample Unit";
  }
  if (/\bPool\s*\(\s*\d+\s*\)/.test(cmd) && /listdir|imap/.test(cmd)) {
    return "BASH_DENIED: 禁止多进程扫仓（会打满 NFS）";
  }
  const product = String(process.env.AGENTSMARK_ROOT || "").replace(/\/+$/, "");
  if (product && cmd.includes(product)
    && /(?:^|[;&|]\s*)(?:rm\b|mv\b|tee\b|sed\s+-i|git\s+commit|>{1,2})/.test(cmd)) {
    return "WRITE_DENIED: 产品仓只读。只许 read / page_accept";
  }
  return null;
}

function sessionCwd(): string {
  return poolRootFromEnv();
}

function denySearchPath(searchDir: string | undefined, tool: "find" | "grep"): string | null {
  const cwd = sessionCwd();
  const abs = absFromCwd(String(searchDir || cwd || "."), cwd);
  if (isDatePoolRoot(abs) || isPoolHeavyDir(abs) || (!searchDir && isDatePoolRoot(cwd))) {
    return `${tool.toUpperCase()}_DENIED: 禁止在池根或 $池/cache 用 ${tool}/fd；定点到仓内第二层，或 POST harvest`;
  }
  if (isUnderPool(abs) && poolRelDepth(abs) < 2) {
    return `${tool.toUpperCase()}_DENIED: 池内 ${tool} 至少要到仓内第二层（例如 smt_benchmark/data/{board}）`;
  }
  return null;
}

export function denyFindTool(input: { path?: unknown } | undefined, cwd = ""): string | null {
  const prev = process.env.PI_WEB_OPEN_FOLDER;
  if (cwd && !poolRootFromEnv()) process.env.PI_WEB_OPEN_FOLDER = cwd;
  try {
    const path = input && typeof input.path === "string" ? input.path : undefined;
    return denySearchPath(path, "find");
  } finally {
    if (cwd && prev === undefined) delete process.env.PI_WEB_OPEN_FOLDER;
    else if (cwd && prev !== undefined) process.env.PI_WEB_OPEN_FOLDER = prev;
  }
}

export function denyGrepTool(input: { path?: unknown } | undefined, cwd = ""): string | null {
  const prev = process.env.PI_WEB_OPEN_FOLDER;
  if (cwd && !poolRootFromEnv()) process.env.PI_WEB_OPEN_FOLDER = cwd;
  try {
    const path = input && typeof input.path === "string" ? input.path : undefined;
    return denySearchPath(path, "grep");
  } finally {
    if (cwd && prev === undefined) delete process.env.PI_WEB_OPEN_FOLDER;
    else if (cwd && prev !== undefined) process.env.PI_WEB_OPEN_FOLDER = prev;
  }
}

export function denyCodingWalkTool(
  toolName: string,
  input: { path?: unknown } | undefined,
  cwd = "",
): string | null {
  const name = String(toolName || "").replace(/^mcp__/, "");
  if (name === "find") return denyFindTool(input, cwd);
  if (name === "grep") return denyGrepTool(input, cwd);
  return null;
}

export function createPoolWalkGuardExtension(cwd = ""): InlineExtension {
  const sessionDir = cwd || poolRootFromEnv();
  return {
    name: "agentsmark-pool-walk-guard",
    hidden: true,
    factory: (pi) => {
      pi.on("tool_call", (event) => {
        const payload = event as { input?: { path?: unknown }; args?: { path?: unknown } };
        const denied = denyCodingWalkTool(
          String(event.toolName || ""),
          payload.input || payload.args,
          sessionDir,
        );
        if (!denied) return undefined;
        return { block: true, reason: denied };
      });
    },
  };
}

export function bashDeniedResult(reason: string) {
  return {
    content: [{ type: "text" as const, text: reason }],
    details: undefined,
    structuredContent: {
      output: reason,
      truncated: false,
      exit_code: 2,
      wall_time_seconds: 0,
    },
    isError: true,
  };
}
