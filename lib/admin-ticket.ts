/**
 * Short-lived ticket the annotation login signs and pi-web exchanges for a cookie.
 * The leaf is inside the ticket. `?admin=` and `x-aoi-admin` are not the login.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { isBlockedAdminLeaf } from "./admin-leaf";

export const ADMIN_TICKET_TTL_MS = 5 * 60 * 1000;
export const ADMIN_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ASCII_LEAF = /^[a-z0-9._-]{1,80}$/;

let cachedSecret = "";

export function ticketSecret(): string {
  const direct = String(process.env.PI_WEB_TICKET_SECRET || "").trim();
  if (direct) return direct;
  if (cachedSecret) return cachedSecret;
  const file = String(process.env.PI_WEB_TICKET_SECRET_FILE || "/home/aoi/session-private/.ticket-secret").trim();
  try {
    const value = readFileSync(file, "utf8").trim();
    if (value) cachedSecret = value;
  } catch {
    cachedSecret = "";
  }
  return cachedSecret;
}

export function resetTicketSecretCache(): void {
  cachedSecret = "";
}

function b64url(value: Buffer): string {
  return value.toString("base64url");
}

function signAdminToken(
  leaf: string,
  secret: string,
  kind: "t" | "c",
  now: number,
  ttlMs: number,
): string {
  if (!secret || !ASCII_LEAF.test(leaf) || isBlockedAdminLeaf(leaf)) {
    throw new Error("admin ticket leaf is not usable");
  }
  const body = kind === "c" ? { l: leaf, e: now + ttlMs, k: "c" } : { l: leaf, e: now + ttlMs };
  const payload = b64url(Buffer.from(JSON.stringify(body)));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `v1.${payload}.${sig}`;
}

export function signAdminTicket(
  leaf: string,
  secret: string,
  now = Date.now(),
  ttlMs = ADMIN_TICKET_TTL_MS,
): string {
  return signAdminToken(leaf, secret, "t", now, ttlMs);
}

/** HttpOnly login cookie. A ticket cannot be replayed as this cookie. */
export function signAdminCookie(
  leaf: string,
  secret: string,
  now = Date.now(),
  ttlMs = ADMIN_COOKIE_TTL_MS,
): string {
  return signAdminToken(leaf, secret, "c", now, ttlMs);
}

function verifyAdminToken(token: string, secret: string, kind: "t" | "c", now: number): string {
  if (!secret) return "";
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return "";
  const expected = createHmac("sha256", secret).update(parts[1]).digest();
  let got: Buffer;
  try {
    got = Buffer.from(parts[2], "base64url");
  } catch {
    return "";
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return "";
  let body: { l?: unknown; e?: unknown; k?: unknown };
  try {
    body = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { l?: unknown; e?: unknown; k?: unknown };
  } catch {
    return "";
  }
  if (kind === "t" && body.k !== undefined) return "";
  if (kind === "c" && body.k !== "c") return "";
  if (typeof body.l !== "string" || typeof body.e !== "number" || !Number.isFinite(body.e)) return "";
  if (body.e < now) return "";
  if (!ASCII_LEAF.test(body.l) || isBlockedAdminLeaf(body.l)) return "";
  return body.l;
}

/** Empty when the ticket is missing, forged, expired, or is actually a cookie. */
export function verifyAdminTicket(ticket: string, secret: string, now = Date.now()): string {
  return verifyAdminToken(ticket, secret, "t", now);
}

/** Empty when the cookie is missing, forged, expired, unsigned, or is a ticket. */
export function verifyAdminCookie(token: string, secret: string, now = Date.now()): string {
  return verifyAdminToken(token, secret, "c", now);
}
