/**
 * Cross-machine UI state per login: pinned sessions and unread markers.
 * Stored beside the warehouse (`.agent/pi-web/ui-state/<admin>.json`) because
 * the session root is host-local: a second machine would otherwise start blank.
 * Only these two keys exist; this is not a general key-value store.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeWebAdmin, warehouseRoot } from "./web-admin-scope";

export interface UiState {
  /** `admin::projectKey` → pinned session ids, same shape as the local map. */
  pins?: Record<string, string[]>;
  unread?: string[];
}

const MAX_IDS = 400;
const MAX_ID_LEN = 200;
const MAX_SCOPES = 40;

export function uiStateDir(): string {
  const root = warehouseRoot();
  return root ? join(root, ".agent", "pi-web", "ui-state") : "";
}

export function uiStatePath(admin: string): string {
  const dir = uiStateDir();
  const name = sanitizeWebAdmin(admin);
  if (!dir || !name) return "";
  return join(dir, `${name}.json`);
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || id.length > MAX_ID_LEN || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

/** Drop anything outside the whitelist so a bad client cannot grow the file. */
export function normalizeUiState(raw: unknown): UiState {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: UiState = {};
  if (Array.isArray(rec.unread)) out.unread = cleanIds(rec.unread);
  const pinsRaw = rec.pins;
  if (pinsRaw && typeof pinsRaw === "object" && !Array.isArray(pinsRaw)) {
    const pins: Record<string, string[]> = {};
    for (const [scope, ids] of Object.entries(pinsRaw as Record<string, unknown>)) {
      const key = scope.trim().slice(0, MAX_ID_LEN);
      if (!key) continue;
      const clean = cleanIds(ids);
      if (clean.length) pins[key] = clean;
      if (Object.keys(pins).length >= MAX_SCOPES) break;
    }
    out.pins = pins;
  }
  return out;
}

export function readUiState(admin: string): UiState {
  const file = uiStatePath(admin);
  if (!file || !existsSync(file)) return {};
  try {
    return normalizeUiState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

export function writeUiState(admin: string, state: UiState): boolean {
  const file = uiStatePath(admin);
  if (!file) return false;
  try {
    const dir = uiStateDir();
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}
