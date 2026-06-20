import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { applyOne } from "@/lib/apply";
import { getSettings, submittedToday } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ dryRun: z.boolean().default(false) });

/**
 * POST /api/applications/apply-all — apply to every queued match, oldest first,
 * stopping when the daily cap is hit (real submits only). Runs sequentially so
 * one shared browser isn't driven concurrently.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const dryRun = parsed.success ? parsed.data.dryRun : false;

  const queued = await prisma.application.findMany({
    where: { applyState: "queued" },
    orderBy: { appliedAt: "asc" },
    select: { id: true },
  });

  const { dailyCap } = await getSettings();
  let remaining = dryRun ? Infinity : Math.max(0, dailyCap - (await submittedToday()));

  const results = [];
  let submitted = 0;
  let external = 0;
  let needsHuman = 0;
  let stoppedAtCap = false;
  for (const { id } of queued) {
    if (!dryRun && remaining <= 0) {
      stoppedAtCap = true;
      break;
    }
    const r = await applyOne(id, dryRun);
    results.push(r);
    if (r.state === "submitted") {
      submitted += 1;
      remaining -= 1;
    } else if (r.state === "skipped_external") external += 1;
    else if (r.state === "needs_human") needsHuman += 1;
  }

  return NextResponse.json({
    total: queued.length,
    processed: results.length,
    submitted,
    external,
    needsHuman,
    dryRun,
    stoppedAtCap,
    results,
  });
}
