import { NextResponse } from "next/server";
import { getDashboardStats, resolveRange } from "@/lib/analytics";

export const runtime = "nodejs";

/** GET — dashboard stats. ?range=today|yesterday|week|month|custom&from=&to= */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = resolveRange(
    searchParams.get("range") ?? "month",
    searchParams.get("from") ?? undefined,
    searchParams.get("to") ?? undefined
  );
  const stats = await getDashboardStats(range);
  return NextResponse.json({ stats, range });
}
