import { NextResponse } from "next/server";
import { clearAdminSshKey, readAdminSshStatus, saveAdminSshKey } from "@/lib/admin-ssh";
import { adminFromRequest, resolveCurrentAdminAsync, withWebAdmin } from "@/lib/web-admin-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function currentAdmin(req: Request): Promise<string> {
  return (await resolveCurrentAdminAsync()) || adminFromRequest(req);
}

export async function GET(req: Request) {
  return withWebAdmin(req, async () => {
    const admin = await currentAdmin(req);
    if (!admin) return NextResponse.json({ error: "admin required" }, { status: 400 });
    return NextResponse.json(readAdminSshStatus(admin));
  });
}

export async function PUT(req: Request) {
  return withWebAdmin(req, async () => {
    const admin = await currentAdmin(req);
    if (!admin) return NextResponse.json({ error: "admin required" }, { status: 400 });
    try {
      const body = await req.json() as { privateKey?: unknown; publicKey?: unknown; host?: unknown };
      const status = saveAdminSshKey(admin, {
        privateKey: typeof body.privateKey === "string" ? body.privateKey : "",
        publicKey: typeof body.publicKey === "string" ? body.publicKey : "",
        host: typeof body.host === "string" ? body.host : "",
      });
      return NextResponse.json(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid key";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}

export async function DELETE(req: Request) {
  return withWebAdmin(req, async () => {
    const admin = await currentAdmin(req);
    if (!admin) return NextResponse.json({ error: "admin required" }, { status: 400 });
    clearAdminSshKey(admin);
    return NextResponse.json({ configured: false, fingerprint: "", host: "", algorithm: "" });
  });
}
