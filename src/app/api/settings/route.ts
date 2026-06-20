import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** GET — current auto-apply settings. */
export async function GET() {
  return NextResponse.json(await getSettings());
}

const patchSchema = z.object({
  autoApplyEnabled: z.boolean().optional(),
  dailyCap: z.number().int().min(1).max(100).optional(),
  dryRunFirst: z.boolean().optional(),
});

/** PATCH — update auto-apply settings. */
export async function PATCH(req: Request) {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings." }, { status: 400 });
  }
  const row = await prisma.appSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.data },
    update: parsed.data,
  });

  // When auto-apply is turned ON, backfill: queue existing 100% matches that
  // haven't been acted on, so the "Ready to apply" tab fills immediately
  // (queueing during a scan is otherwise only forward-looking).
  if (parsed.data.autoApplyEnabled === true) {
    await prisma.application.updateMany({
      where: { matchPct: 100, applyState: "not_attempted", status: { not: "applied" } },
      data: { applyState: "queued" },
    });
  }

  return NextResponse.json({
    autoApplyEnabled: row.autoApplyEnabled,
    dailyCap: row.dailyCap,
    dryRunFirst: row.dryRunFirst,
  });
}
