import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { normalizeUiState, readUiState, writeUiState } from "@/lib/ui-state";
import { resolveCurrentAdminAsync } from "@/lib/web-admin-scope";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Empty when this browser is not signed in; the sidebar then keeps localStorage only. */
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const admin = await resolveCurrentAdminAsync();
  if (!admin) {
    return NextResponse.json({ pins: {}, unread: [], persisted: false }, { headers: NO_STORE });
  }
  const state = readUiState(admin);
  return NextResponse.json({ ...state, persisted: true }, { headers: NO_STORE });
}

/** Whole-document replace: the sidebar owns both keys, so partial merges would race. */
export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "json_required" }, { status: 415, headers: NO_STORE });
  }
  const admin = await resolveCurrentAdminAsync();
  if (!admin) {
    return NextResponse.json({ ok: false, persisted: false }, { status: 200, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  const persisted = writeUiState(admin, normalizeUiState(body));
  return NextResponse.json({ ok: persisted, persisted }, { headers: NO_STORE });
}
