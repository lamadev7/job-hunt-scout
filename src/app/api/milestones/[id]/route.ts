import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { applyMilestoneToProfile } from "@/lib/agent/milestones";

export const runtime = "nodejs";

const schema = z.object({ done: z.boolean() });

/** PATCH — toggle a milestone. Completing it folds the skill into the profile. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const milestone = await prisma.milestone.update({
    where: { id },
    data: {
      done: parsed.data.done,
      completedAt: parsed.data.done ? new Date() : null,
    },
  });

  let profileUpdated = false;
  if (parsed.data.done) {
    profileUpdated = await applyMilestoneToProfile(milestone.skill);
  }

  return NextResponse.json({ milestone, profileUpdated });
}
