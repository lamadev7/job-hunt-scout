import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { asArray } from "@/lib/utils";
import { recomputeMilestones } from "@/lib/agent/milestones";

export const runtime = "nodejs";

/** GET — applied/matched jobs with filters: ?status=applied&q=stripe */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // applied | matched | all
  const applyState = searchParams.get("applyState"); // queued | submitted | ...
  const q = searchParams.get("q")?.trim();

  const apps = await prisma.application.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(applyState ? { applyState } : {}),
      ...(q
        ? {
            job: {
              OR: [
                { company: { contains: q } },
                { position: { contains: q } },
              ],
            },
          }
        : {}),
    },
    include: { job: true },
    orderBy: { appliedAt: "desc" },
    take: 50, // cap search results
  });

  const items = apps.map((a) => ({
    id: a.id,
    status: a.status,
    matchPct: a.matchPct,
    fitScore: a.fitScore,
    matchedTerms: asArray<string>(a.matchedTerms),
    missingTerms: asArray<string>(a.missingTerms),
    suggestions: asArray<string>(a.suggestions),
    appliedAt: a.appliedAt,
    applyState: a.applyState,
    applyError: a.applyError,
    screenshots: asArray<string>(a.screenshots),
    attemptedAt: a.attemptedAt,
    job: {
      id: a.job.id,
      company: a.job.company,
      position: a.job.position,
      url: a.job.url,
      portal: a.job.portal,
      location: a.job.location,
      seniority: a.job.seniority,
      remote: a.job.remote,
      easyApply: a.job.easyApply,
      yearsRequired: a.job.yearsRequired,
      applicantCount: a.job.applicantCount,
      salaryMin: a.job.salaryMin,
      salaryMax: a.job.salaryMax,
      postedAt: a.job.postedAt,
      jd: a.job.jd,
      requiredSkills: asArray<string>(a.job.requiredSkills),
      niceSkills: asArray<string>(a.job.niceSkills),
    },
  }));

  return NextResponse.json({ items });
}

/**
 * DELETE — clear job-search history. Removes saved applications (matches/applied)
 * then rebuilds milestones (which derive from the gap data). Optional ?status=
 * limits the clear to one tab; otherwise everything is cleared. The scraped Job
 * pool is kept — only the user's results history is wiped.
 */
export async function DELETE(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const where = status && status !== "all" ? { status } : {};
  const { count } = await prisma.application.deleteMany({ where });
  await recomputeMilestones();
  return NextResponse.json({ cleared: count });
}
