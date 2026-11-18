/** Session-estimated token usage by Beijing day. Not a provider invoice. */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isBlockedAdminLeaf } from "./admin-leaf";
import { sanitizeWebAdmin, sessionsStoreRoot } from "./web-admin-scope";

export type AdminDayUsage = {
  admin: string;
  day: string;
  input: number;
  output: number;
  cache: number;
  cost_usd: number;
  by_provider: Record<string, { input: number; output: number; cache: number; cost_usd: number }>;
  session_count: number;
};

type FileDaySlice = {
  input: number;
  output: number;
  cache: number;
  cost_usd: number;
  by_provider: AdminDayUsage["by_provider"];
};

type IndexFile = {
  mtimeMs: number;
  size: number;
  days: Record<string, FileDaySlice>;
};

type IndexDoc = { files: Record<string, IndexFile> };

function emptySlice(): FileDaySlice {
  return { input: 0, output: 0, cache: 0, cost_usd: 0, by_provider: {} };
}

export function beijingDay(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function superadmins(): Set<string> {
  const raw = String(process.env.PI_WEB_SUPERADMINS || "flyingu").split(",");
  return new Set(raw.map((name) => sanitizeWebAdmin(name)).filter(Boolean));
}

export function isSuperadmin(admin: string): boolean {
  return superadmins().has(sanitizeWebAdmin(admin));
}

function addSlice(target: FileDaySlice, usage: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}, provider: string): void {
  const input = Number(usage.input || 0);
  const output = Number(usage.output || 0);
  const cache = Number(usage.cacheRead || 0) + Number(usage.cacheWrite || 0);
  const cost = Number(usage.cost?.total || 0);
  target.input += input;
  target.output += output;
  target.cache += cache;
  target.cost_usd += cost;
  const key = provider || "unknown";
  const bucket = target.by_provider[key] ?? { input: 0, output: 0, cache: 0, cost_usd: 0 };
  bucket.input += input;
  bucket.output += output;
  bucket.cache += cache;
  bucket.cost_usd += cost;
  target.by_provider[key] = bucket;
}

function usageFromRecord(record: Record<string, unknown>): {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
} | null {
  const usage = record.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  return usage as {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
  };
}

function scanJsonl(path: string): Record<string, FileDaySlice> {
  const days: Record<string, FileDaySlice> = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return days;
  }
  for (const line of text.split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const rec = parsed as Record<string, unknown>;
    const usage = usageFromRecord(rec) || (rec.message && typeof rec.message === "object"
      ? usageFromRecord(rec.message as Record<string, unknown>)
      : null);
    if (!usage) continue;
    const ts = Number(rec.timestamp || rec.ts || 0);
    const day = Number.isFinite(ts) && ts > 0 ? beijingDay(ts) : beijingDay(Date.now());
    const provider = String(
      rec.provider
      || (rec.message && typeof rec.message === "object" && (rec.message as { provider?: string }).provider)
      || "",
    );
    days[day] ??= emptySlice();
    addSlice(days[day], usage, provider);
  }
  return days;
}

function indexPath(adminDir: string): string {
  return join(adminDir, "pi", "usage-day-index.json");
}

function loadIndex(adminDir: string): IndexDoc {
  const path = indexPath(adminDir);
  if (!existsSync(path)) return { files: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as IndexDoc;
    return parsed && typeof parsed === "object" && parsed.files ? parsed : { files: {} };
  } catch {
    return { files: {} };
  }
}

function saveIndex(adminDir: string, doc: IndexDoc): void {
  try {
    writeFileSync(indexPath(adminDir), `${JSON.stringify(doc)}\n`);
  } catch {
    // Index is a cache. A failed write just means the next request rescan.
  }
}

function listAdmins(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => sanitizeWebAdmin(entry.name))
    .filter((name) => name && !isBlockedAdminLeaf(name) && name !== "_quarantine");
}

function usageForAdmin(root: string, admin: string): AdminDayUsage[] {
  const adminDir = join(root, admin);
  const piDir = join(adminDir, "pi");
  if (!existsSync(piDir)) return [];
  const index = loadIndex(adminDir);
  let dirty = false;
  const files = readdirSync(piDir).filter((name) => name.endsWith(".jsonl"));
  const byDay = new Map<string, AdminDayUsage>();
  const sessionsByDay = new Map<string, number>();
  for (const name of files) {
    const full = join(piDir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    const prev = index.files[name];
    let days = prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size ? prev.days : null;
    if (!days) {
      days = scanJsonl(full);
      index.files[name] = { mtimeMs: st.mtimeMs, size: st.size, days };
      dirty = true;
    }
    const touched = new Set<string>();
    for (const [day, slice] of Object.entries(days)) {
      touched.add(day);
      const row = byDay.get(day) ?? {
        admin,
        day,
        input: 0,
        output: 0,
        cache: 0,
        cost_usd: 0,
        by_provider: {},
        session_count: 0,
      };
      row.input += slice.input;
      row.output += slice.output;
      row.cache += slice.cache;
      row.cost_usd += slice.cost_usd;
      for (const [provider, bucket] of Object.entries(slice.by_provider)) {
        const cur = row.by_provider[provider] ?? { input: 0, output: 0, cache: 0, cost_usd: 0 };
        cur.input += bucket.input;
        cur.output += bucket.output;
        cur.cache += bucket.cache;
        cur.cost_usd += bucket.cost_usd;
        row.by_provider[provider] = cur;
      }
      byDay.set(day, row);
    }
    for (const day of touched) sessionsByDay.set(day, (sessionsByDay.get(day) ?? 0) + 1);
  }
  if (dirty) saveIndex(adminDir, index);
  const rows = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  for (const row of rows) row.session_count = sessionsByDay.get(row.day) ?? 0;
  return rows;
}

export function listAdminUsage(opts: {
  viewer: string;
  from?: string;
  to?: string;
}): { estimate: true; note: string; rows: AdminDayUsage[] } {
  const root = sessionsStoreRoot();
  const viewer = sanitizeWebAdmin(opts.viewer);
  const admins = isSuperadmin(viewer) ? listAdmins(root) : viewer ? [viewer] : [];
  const from = String(opts.from || "").trim();
  const to = String(opts.to || "").trim();
  const rows = admins.flatMap((admin) => usageForAdmin(root, admin)).filter((row) => {
    if (from && row.day < from) return false;
    if (to && row.day > to) return false;
    return true;
  });
  return {
    estimate: true,
    note: "会话估算，不是 DeepSeek / 供应商账单",
    rows,
  };
}

export function formatUsageDigest(rows: AdminDayUsage[], day: string): string {
  const lines = [
    `[agentSMark] ${day} 用量（会话估算，不是供应商账单）`,
    "",
  ];
  const ranked = [...rows].sort((a, b) => b.cost_usd - a.cost_usd);
  for (const row of ranked) {
    lines.push(
      `${row.admin}\tinput=${row.input}\toutput=${row.output}\tcache=${row.cache}\tusd=${row.cost_usd.toFixed(4)}\tsessions=${row.session_count}`,
    );
  }
  if (ranked.length === 0) lines.push("(empty)");
  return lines.join("\n");
}
