/** Browser-only admin identity from the iframe query. Do not import Node ALS here. */

function sanitize(admin: string): string {
  const name = String(admin || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 80);
  if (!name || name === "." || name === "..") return "";
  return name;
}

export function clientWebAdmin(search = ""): string {
  try {
    const query = search || (typeof window !== "undefined" ? window.location.search : "");
    return sanitize(new URLSearchParams(query).get("admin") || "");
  } catch {
    return "";
  }
}

export function adminScopedStorageKey(base: string, admin = clientWebAdmin()): string {
  return `${base}:${admin || "_none"}`;
}
