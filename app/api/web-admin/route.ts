import { NextResponse } from "next/server";
import { resolveCurrentAdminAsync } from "@/lib/web-admin-scope";

function withClearCors(req: Request, res: NextResponse): NextResponse {
  const origin = req.headers.get("origin") || "";
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).hostname : "";
  } catch {
    originHost = "";
  }
  const host = (req.headers.get("host") || "").replace(/:\d+$/, "");
  if (!originHost || originHost !== host) return res;
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type");
  res.headers.set("Vary", "Origin");
  return res;
}

/**
 * Who this browser is signed in as. The iframe URL no longer carries ?admin=,
 * so the shell needs one read to scope per-admin UI state. Never accepts a
 * caller-supplied name: the signed cookie decides.
 */
export async function GET(req: Request) {
  const admin = await resolveCurrentAdminAsync();
  return withClearCors(req, NextResponse.json({ admin }, {
    headers: { "Cache-Control": "no-store" },
  }));
}

/** Clear the sticky admin cookie. Called when the job-board login signs out. */
export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("aoi_admin", "", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 0,
  });
  res.cookies.set("aoi_leaf", "", {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 0,
  });
  return withClearCors(req, res);
}

export async function OPTIONS(req: Request) {
  return withClearCors(req, new NextResponse(null, { status: 204 }));
}
