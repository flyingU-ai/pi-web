/**
 * Extra DatePool roots beside the live warehouse.
 * Primary is always warehouseRoot(); attach pools are read-only mounts.
 */

import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { warehouseRoot } from "./web-admin-scope";

export type DataPoolRole = "primary" | "attach";

export interface DataPool {
  id: string;
  label: string;
  root: string;
  role: DataPoolRole;
  readonly: boolean;
}

export const DATA_POOLS_ENV = "PI_WEB_DATA_POOLS";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

type Cache = { key: string; pools: DataPool[] };
let cache: Cache | null = null;

export function resetDataPoolsCache(): void {
  cache = null;
}

function stripSlash(target: string): string {
  const raw = String(target || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "") || "/";
}

function underTree(target: string, root: string): boolean {
  if (!root) return false;
  const abs = resolve(target);
  const base = resolve(root);
  return abs === base || abs.startsWith(base + sep);
}

function usableRoot(target: string): string {
  const abs = stripSlash(target);
  if (!abs || !abs.startsWith("/")) return "";
  try {
    if (!existsSync(abs)) return "";
    return stripSlash(realpathSync(abs));
  } catch {
    return existsSync(abs) ? resolve(abs) : "";
  }
}

const CANONICAL_MAX = 4096;
const canonicalMemo = new Map<string, string>();

/** realpath the deepest existing ancestor, then re-attach the missing tail. */
function canonicalPath(target: string): string {
  const abs = resolve(target);
  const cached = canonicalMemo.get(abs);
  if (cached !== undefined) return cached;
  const parts = abs.split(sep).filter(Boolean);
  let base: string = sep;
  let i = 0;
  for (; i < parts.length; i += 1) {
    const next = base === sep ? `${sep}${parts[i]}` : `${base}${sep}${parts[i]}`;
    try {
      base = realpathSync(next);
    } catch {
      break;
    }
  }
  const out = i >= parts.length ? stripSlash(base) : stripSlash(resolve(base, ...parts.slice(i)));
  if (canonicalMemo.size >= CANONICAL_MAX) canonicalMemo.clear();
  canonicalMemo.set(abs, out);
  return out;
}

/**
 * Membership that survives symlinked mounts: /dataset/coco_fu resolves through
 * /volume2/... to /mnt/aoi_nfs/..., so the listing path and the catalog root
 * never match lexically. Compare both spellings before saying "not this pool".
 */
function underTreeLoosely(target: string, root: string): boolean {
  if (!root) return false;
  if (underTree(target, root)) return true;
  const abs = String(target || "").trim();
  if (!abs) return false;
  return underTree(canonicalPath(abs), canonicalPath(root));
}

interface ParsedPool {
  id: string;
  label: string;
  root: string;
  role: DataPoolRole;
}

function asRole(value: unknown): DataPoolRole | "" {
  const role = String(value || "").trim().toLowerCase();
  if (role === "primary") return "primary";
  if (role === "attach" || role === "readonly" || role === "next") return "attach";
  return "";
}

function parseJsonPools(raw: string): ParsedPool[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  const out: ParsedPool[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const id = String(rec.id || "").trim();
    const root = stripSlash(String(rec.root || rec.path || ""));
    const role = asRole(rec.role) || "attach";
    const label = String(rec.label || rec.name || id).trim();
    if (!ID_RE.test(id) || !root) continue;
    out.push({ id, label: label || id, root, role });
  }
  return out;
}

function parseLinePools(raw: string): ParsedPool[] {
  const out: ParsedPool[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("|").map((part) => part.trim());
    if (parts.length < 3) continue;
    const [id, label, root, roleRaw] = parts;
    const role = asRole(roleRaw) || "attach";
    if (!ID_RE.test(id) || !root) continue;
    out.push({ id, label: label || id, root, role });
  }
  return out;
}

function parseConfigured(raw: string): ParsedPool[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return parseJsonPools(trimmed);
  return parseLinePools(trimmed);
}

function primaryPool(warehouse: string): DataPool | null {
  const root = usableRoot(warehouse);
  if (!root) return null;
  return {
    id: "live",
    label: "当前",
    root,
    role: "primary",
    readonly: false,
  };
}

export function listDataPools(env: NodeJS.ProcessEnv = process.env): DataPool[] {
  const warehouse = stripSlash(warehouseRoot());
  const raw = String(env[DATA_POOLS_ENV] || "").trim();
  const key = `${warehouse}::${raw}`;
  if (cache && cache.key === key) return cache.pools;

  const pools: DataPool[] = [];
  const primary = primaryPool(warehouse);
  if (primary) pools.push(primary);

  const seen = new Set(pools.map((pool) => pool.root));
  const ids = new Set(pools.map((pool) => pool.id));
  for (const parsed of parseConfigured(raw)) {
    if (parsed.role === "primary") continue;
    const root = usableRoot(parsed.root);
    if (!root || seen.has(root)) continue;
    let id = parsed.id === "live" ? "next" : parsed.id;
    if (ids.has(id)) id = `${id}_attach`;
    seen.add(root);
    ids.add(id);
    pools.push({
      id,
      label: parsed.label || id,
      root,
      role: "attach",
      readonly: true,
    });
  }

  cache = { key, pools };
  return pools;
}

export function extraDataPoolRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return listDataPools(env).filter((pool) => pool.role === "attach").map((pool) => pool.root);
}

export function catalogDataPoolRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return listDataPools(env).map((pool) => pool.root);
}

export function isCatalogDataPoolRoot(target: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const abs = stripSlash(target);
  if (!abs) return false;
  return catalogDataPoolRoots(env).some((root) => stripSlash(root) === abs || resolve(root) === resolve(abs));
}

export function isPrimaryDataPoolPath(target: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const primary = listDataPools(env).find((pool) => pool.role === "primary");
  return Boolean(primary && underTreeLoosely(target, primary.root));
}

export function isReadonlyDataPoolPath(target: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const abs = String(target || "").trim();
  if (!abs) return false;
  return listDataPools(env).some((pool) => pool.readonly && underTreeLoosely(abs, pool.root));
}

export const READONLY_DATA_POOL_REASON = "这是只读附加数据池，不能写入。入库仍走当前池 _incoming。";
