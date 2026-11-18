/**
 * Account leaf for sessions, keys, and private code.
 * ASCII logins keep their directory (`FlyingU` → `flyingu`).
 * Any other name, including Chinese, gets a stable hash so two names
 * cannot collapse into `_`.
 */

import { createHash } from "node:crypto";

const ASCII_SLUG = /^[A-Za-z0-9._-]{1,80}$/;

/** Directories that must not become a live login. `_` is the old Chinese collision. */
export function isBlockedAdminLeaf(leaf: string): boolean {
  return leaf === "_" || leaf === "_quarantine" || leaf === "_no_admin";
}

export function accountLeaf(name: string): string {
  const normalized = String(name || "").trim().split(/\s+/).filter(Boolean).join(" ");
  if (!normalized) return "";
  if (ASCII_SLUG.test(normalized)) {
    const leaf = normalized.toLowerCase();
    if (leaf === "." || leaf === ".." || isBlockedAdminLeaf(leaf)) return "";
    return leaf;
  }
  const digest = createHash("sha256").update(normalized.toLowerCase(), "utf8").digest("hex").slice(0, 16);
  return `a_${digest}`;
}
