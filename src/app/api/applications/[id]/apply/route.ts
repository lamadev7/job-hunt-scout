import { NextResponse } from "next/server";
import { z } from "zod";
import { applyOne } from "@/lib/apply";

export const runtime = "nodejs";
export const maxDuration = 300; // real apply drives a browser form

const schema = z.object({ dryRun: z.boolean().default(false) });

/** POST /api/applications/:id/apply — apply (or dry-run) to one saved match. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const dryRun = parsed.success ? parsed.data.dryRun : false;

  const result = await applyOne(id, dryRun);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
