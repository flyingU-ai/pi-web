import { NextRequest, NextResponse } from "next/server";
import { listAdminUsage } from "@/lib/admin-usage";
import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveCurrentAdminAsync } from "@/lib/web-admin-scope";

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const admin = await resolveCurrentAdminAsync();
  if (!admin) return NextResponse.json({ error: "admin required" }, { status: 401 });
  const from = request.nextUrl.searchParams.get("from") || undefined;
  const to = request.nextUrl.searchParams.get("to") || undefined;
  return NextResponse.json(listAdminUsage({ viewer: admin, from, to }));
}
