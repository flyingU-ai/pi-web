import { NextResponse } from "next/server";

/** Clear the sticky admin cookie. Called when the job-board login signs out. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("aoi_admin", "", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 0,
  });
  return res;
}
