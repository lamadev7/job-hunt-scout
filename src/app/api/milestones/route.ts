import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recomputeMilestones } from "@/lib/agent/milestones";
import { getStrength } from "@/lib/strength";

export const runtime = "nodejs";

/** GET — milestones (priority desc) + computed strength cards. */
export async function GET() {
  const [milestones, strength] = await Promise.all([
    prisma.milestone.findMany({ orderBy: [{ done: "asc" }, { priority: "desc" }] }),
    getStrength(),
  ]);
  return NextResponse.json({ milestones, strength });
}

/** POST — rebuild milestones from current application gaps. */
export async function POST() {
  const count = await recomputeMilestones();
  const milestones = await prisma.milestone.findMany({
    orderBy: [{ done: "asc" }, { priority: "desc" }],
  });
  return NextResponse.json({ count, milestones });
}
