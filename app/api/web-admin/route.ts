import { NextResponse } from "next/server";

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
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type");
  res.headers.set("Vary", "Origin");
  return res;
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
