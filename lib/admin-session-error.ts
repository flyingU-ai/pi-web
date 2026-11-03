/** Shared copy when DatePool APIs refuse a request without `aoi_admin`. */

export const ADMIN_REQUIRED_ERROR = "admin required";

export const ADMIN_REQUIRED_HINT =
  "管理员身份已丢失。请用带 ?admin= 的地址重新打开助手。";

export function isAdminRequiredFailure(
  status: number,
  body?: { error?: string } | null,
): boolean {
  if (status !== 401) return false;
  const error = String(body?.error || "").trim();
  return !error || error === ADMIN_REQUIRED_ERROR;
}

export async function readApiErrorBody(res: Response): Promise<{ error?: string } | null> {
  try {
    const data = await res.clone().json();
    return data && typeof data === "object" ? data as { error?: string } : null;
  } catch {
    return null;
  }
}

export async function messageForApiFailure(res: Response): Promise<string> {
  const body = await readApiErrorBody(res);
  if (isAdminRequiredFailure(res.status, body)) return ADMIN_REQUIRED_HINT;
  return String(body?.error || "").trim() || `HTTP ${res.status}`;
}
