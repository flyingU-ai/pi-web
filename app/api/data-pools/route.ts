import { NextResponse } from "next/server";
import { listDataPools } from "@/lib/data-pools";

export async function GET() {
  const pools = listDataPools().map((pool) => ({
    id: pool.id,
    label: pool.label,
    root: pool.root,
    role: pool.role,
    readonly: pool.readonly,
  }));
  return NextResponse.json({ pools });
}
