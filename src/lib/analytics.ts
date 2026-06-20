import { prisma } from "@/lib/db";
import { asArray } from "@/lib/utils";
import { canonical } from "@/lib/matching/synonyms";
import type { DashboardStats } from "@/lib/types";

export type Range = { from: Date; to: Date };

export async function getDashboardStats(range: Range): Promise<DashboardStats> {
  const apps = await prisma.application.findMany({
    where: { appliedAt: { gte: range.from, lte: range.to } },
    include: { job: { select: { applicantCount: true, portal: true } } },
    orderBy: { appliedAt: "asc" },
  });

  const applied = apps.filter((a) => a.status === "applied");
  const matched = apps.filter((a) => a.status === "matched" || a.status === "applied");

  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((s, n) => s + n, 0) / xs.length) : 0;

  const avgMatchPct = avg(apps.map((a) => a.matchPct));
  const avgFitScore = avg(apps.map((a) => a.fitScore));
  const avgApplicants = avg(apps.map((a) => a.job?.applicantCount ?? 0));

  // top missing skills across the range
  const missCount = new Map<string, { term: string; count: number }>();
  for (const a of apps) {
    for (const m of asArray<string>(a.missingTerms)) {
      const k = canonical(m);
      const cur = missCount.get(k);
      if (cur) cur.count += 1;
      else missCount.set(k, { term: m, count: 1 });
    }
  }
  const topMissing = [...missCount.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // by portal
  const portalCount = new Map<string, number>();
  for (const a of apps) {
    const p = a.job?.portal ?? "unknown";
    portalCount.set(p, (portalCount.get(p) ?? 0) + 1);
  }
  const byPortal = [...portalCount.entries()].map(([portal, count]) => ({ portal, count }));

  // daily timeline
  const dayMap = new Map<string, { applied: number; matched: number }>();
  for (const a of apps) {
    const day = a.appliedAt.toISOString().slice(0, 10);
    const cur = dayMap.get(day) ?? { applied: 0, matched: 0 };
    if (a.status === "applied") cur.applied += 1;
    else cur.matched += 1;
    dayMap.set(day, cur);
  }
  const timeline = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, applied: v.applied, matched: v.matched }));

  return {
    totalApplied: applied.length,
    totalMatched: matched.length,
    avgMatchPct,
    avgFitScore,
    avgApplicants,
    topMissing,
    byPortal,
    timeline,
  };
}

export function resolveRange(key: string, fromStr?: string, toStr?: string): Range {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  switch (key) {
    case "today":
      return { from, to };
    case "yesterday": {
      from.setDate(from.getDate() - 1);
      const yTo = new Date(from);
      yTo.setHours(23, 59, 59, 999);
      return { from, to: yTo };
    }
    case "week":
      from.setDate(from.getDate() - 6);
      return { from, to };
    case "month":
      from.setDate(from.getDate() - 29);
      return { from, to };
    case "custom":
      return {
        from: fromStr ? new Date(fromStr) : from,
        to: toStr ? new Date(`${toStr}T23:59:59.999`) : to,
      };
    default:
      from.setDate(from.getDate() - 29);
      return { from, to };
  }
}
