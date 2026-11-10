/**
 * One-shot alarms taken from the model's own「下一步 / 我盯着」table.
 * The host stores the row text. It does not invent times or rewrite the gate.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { adminFromSessionFile, sanitizeWebAdmin, sessionsStoreRoot } from "./web-admin-scope";

export const PLAN_ALARM_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanAlarmRow {
  at: string;
  event: string;
  criterion: string;
  fired: boolean;
  skip?: string;
}

export interface PlanAlarmDoc {
  sessionId: string;
  admin: string;
  updated_at: string;
  rows: PlanAlarmRow[];
}

interface Clock {
  hour: number;
  minute: number;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function sanitizeSessionId(sessionId: string): string {
  const id = String(sessionId || "").trim();
  if (!/^[A-Za-z0-9._-]{8,80}$/.test(id)) return "";
  return id;
}

export function alarmFilePath(admin: string, sessionId: string): string {
  const name = sanitizeWebAdmin(admin);
  const id = sanitizeSessionId(sessionId);
  if (!name || !id) return "";
  return join(sessionsStoreRoot(), name, "alarms", `${id}.json`);
}

function shanghaiDay(nowMs: number): string {
  const shifted = new Date(nowMs + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function nextShanghaiIso(clock: Clock, nowMs: number): string {
  const at = Date.parse(`${shanghaiDay(nowMs)}T${pad(clock.hour)}:${pad(clock.minute)}:00+08:00`);
  if (!Number.isFinite(at)) return "";
  const due = at <= nowMs ? at + DAY_MS : at;
  if (due <= nowMs || due - nowMs > DAY_MS) return "";
  return new Date(due).toISOString();
}

function parseClock(cell: string): Clock | null {
  const match = String(cell || "").match(/~?\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  if (!body.trim()) return null;
  return body.split("|").map((cell) => cell.trim());
}

export function extractPlanRows(text: string, nowMs: number): PlanAlarmRow[] {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes("下一步") && lines[i].includes("盯")) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return [];
  let header = -1;
  let timeCol = -1;
  let eventCol = -1;
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    const cells = splitTableRow(lines[i]);
    if (!cells) continue;
    const timeIndex = cells.findIndex((cell) => cell.replace(/\s/g, "") === "时间" || cell.toLowerCase() === "time");
    const eventIndex = cells.findIndex((cell) => cell.replace(/\s/g, "") === "事件" || cell.toLowerCase() === "event");
    if (timeIndex >= 0 && eventIndex >= 0) {
      header = i;
      timeCol = timeIndex;
      eventCol = eventIndex;
      break;
    }
  }
  if (header < 0) return [];
  const rows: PlanAlarmRow[] = [];
  let cursor = header + 1;
  for (; cursor < lines.length; cursor += 1) {
    const cells = splitTableRow(lines[cursor]);
    if (!cells) {
      if (!lines[cursor].trim()) continue;
      break;
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell.replace(/\s/g, "")))) continue;
    const clock = parseClock(cells[timeCol] || "");
    const event = (cells[eventCol] || "").trim().slice(0, 300);
    if (!clock || !event) continue;
    const at = nextShanghaiIso(clock, nowMs);
    if (!at) continue;
    rows.push({ at, event, criterion: "", fired: false });
    if (rows.length >= PLAN_ALARM_LIMIT) {
      cursor += 1;
      break;
    }
  }
  const rest: string[] = [];
  for (let i = cursor; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (rest.length) break;
      continue;
    }
    if (line.startsWith("|") || line.startsWith("#")) break;
    rest.push(line);
    if (rest.join("").length > 300) break;
  }
  const paragraph = rest.join(" ").slice(0, 300);
  const criterion = /判据|SMT|DIP|gate/i.test(paragraph) ? paragraph : "";
  return rows.map((row) => ({ ...row, criterion }));
}

function rowKey(row: Pick<PlanAlarmRow, "at" | "event">): string {
  return `${row.at}\0${row.event}`;
}

export function mergePlanRows(existing: PlanAlarmRow[], extracted: PlanAlarmRow[]): PlanAlarmRow[] {
  const fired = existing.filter((row) => row.fired);
  const firedKeys = new Set(fired.map(rowKey));
  const pending = extracted.filter((row) => !firedKeys.has(rowKey(row))).map((row) => ({
    at: row.at,
    event: row.event,
    criterion: row.criterion,
    fired: false,
  }));
  return [...fired, ...pending];
}

function readAlarm(file: string): PlanAlarmDoc | null {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as PlanAlarmDoc;
    if (!raw || !Array.isArray(raw.rows)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Write only when this assistant text contains a future plan table. */
export function capturePlanAlarm(input: {
  sessionId: string;
  sessionFile: string;
  text: string;
  nowMs?: number;
}): string {
  const extracted = extractPlanRows(input.text, input.nowMs ?? Date.now());
  if (!extracted.length) return "";
  const admin = adminFromSessionFile(input.sessionFile);
  const sessionId = sanitizeSessionId(input.sessionId);
  const dest = alarmFilePath(admin, sessionId);
  if (!dest) return "";
  const existing = readAlarm(dest);
  const doc: PlanAlarmDoc = {
    sessionId,
    admin,
    updated_at: new Date(input.nowMs ?? Date.now()).toISOString(),
    rows: mergePlanRows(existing?.rows || [], extracted),
  };
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, dest);
  return dest;
}
