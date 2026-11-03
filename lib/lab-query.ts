/** Keep lab `admin` (and cwd/session as requested) on every AppShell URL replace. */

export type LabQueryPatch = {
  session?: string | null;
  cwd?: string | null;
};

function readSearch(current: URLSearchParams | string): URLSearchParams {
  if (typeof current === "string") {
    const trimmed = current.startsWith("?") ? current.slice(1) : current;
    return new URLSearchParams(trimmed);
  }
  return new URLSearchParams(current.toString());
}

function setOrDelete(next: URLSearchParams, key: string, value: string | null | undefined): void {
  const text = String(value || "").trim();
  if (text) next.set(key, text);
  else next.delete(key);
}

/** Build `?session=&cwd=&admin=` without dropping the iframe login. */
export function buildLabSearch(
  current: URLSearchParams | string,
  patch: LabQueryPatch = {},
): string {
  const src = readSearch(current);
  const next = new URLSearchParams();
  const session = patch.session === undefined ? src.get("session") : patch.session;
  const cwd = patch.cwd === undefined ? src.get("cwd") : patch.cwd;
  const admin = src.get("admin");
  setOrDelete(next, "session", session);
  setOrDelete(next, "cwd", cwd);
  setOrDelete(next, "admin", admin);
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}
