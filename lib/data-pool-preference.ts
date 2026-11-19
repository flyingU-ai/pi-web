/** Which DatePool the DATA zone shows. This browser only; keyed by admin + cwd. */

const STORAGE_KEY = "pi-web:data-pool";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readMap(storage: StorageLike): Record<string, string | undefined> {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

export function dataPoolStorageScope(cwd: string, admin = ""): string {
  const a = String(admin || "").trim();
  const key = String(cwd || "").trim();
  if (!key) return a || "local";
  return a ? `${a}::${key}` : key;
}

export function readSelectedDataPoolId(
  scope: string,
  storage: StorageLike | null,
): string {
  if (!storage || !scope) return "";
  try {
    const id = readMap(storage)[scope];
    return typeof id === "string" ? id.trim() : "";
  } catch {
    return "";
  }
}

export function writeSelectedDataPoolId(
  scope: string,
  id: string,
  storage: StorageLike | null,
): void {
  if (!storage || !scope) return;
  try {
    const map = readMap(storage);
    const next = String(id || "").trim();
    if (!next) delete map[scope];
    else map[scope] = next;
    storage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota / private mode
  }
}
