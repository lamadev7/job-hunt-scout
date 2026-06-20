import { prisma } from "@/lib/db";
import { asArray } from "@/lib/utils";
import { canonical } from "@/lib/matching/synonyms";
import { categoryFor, demandFor } from "@/lib/matching/vocab";

/**
 * Rebuild learning milestones from aggregated application gaps.
 * The agent counts how often each missing skill appears across the user's
 * applications, weights by market demand, and emits prioritized milestones.
 * Existing done/checked state is preserved by skill name.
 */
export async function recomputeMilestones() {
  const apps = await prisma.application.findMany({
    select: { missingTerms: true },
  });

  const freq = new Map<string, { display: string; count: number }>();
  for (const a of apps) {
    const missing = asArray<string>(a.missingTerms);
    const seenInApp = new Set<string>();
    for (const term of missing) {
      const key = canonical(term);
      if (seenInApp.has(key)) continue; // count once per application
      seenInApp.add(key);
      const cur = freq.get(key);
      if (cur) cur.count += 1;
      else freq.set(key, { display: term, count: 1 });
    }
  }

  const existing = await prisma.milestone.findMany();
  const doneBySkill = new Map(
    existing.map((m) => [canonical(m.skill), { done: m.done, completedAt: m.completedAt }])
  );

  const ranked = [...freq.entries()]
    .map(([key, { display, count }]) => {
      const demand = demandFor(display);
      const priority = Math.round(count * demand * 100);
      return { key, display, count, demand, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12);

  await prisma.$transaction([
    prisma.milestone.deleteMany(),
    ...ranked.map((r) => {
      const prev = doneBySkill.get(r.key);
      return prisma.milestone.create({
        data: {
          skill: r.display,
          category: categoryFor(r.display),
          priority: r.priority,
          demandScore: r.demand,
          frequency: r.count,
          rationale: `Appears in ${r.count} of your applications; market demand ${(r.demand * 100).toFixed(0)}%.`,
          done: prev?.done ?? false,
          completedAt: prev?.completedAt ?? null,
        },
      });
    }),
  ]);

  return ranked.length;
}

/**
 * When a milestone is completed, intelligently fold its skill into the active
 * profile (so future matching credits it). Returns true if the profile changed.
 */
export async function applyMilestoneToProfile(skill: string) {
  const profile = await prisma.profile.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!profile) return false;

  const cat = categoryFor(skill);
  const field = cat === "tool" ? "tools" : cat === "domain" ? "domains" : "skills";
  const list = asArray<string>(profile[field as "skills" | "tools" | "domains"]);
  if (list.some((s) => canonical(s) === canonical(skill))) return false;

  list.push(skill);
  await prisma.profile.update({
    where: { id: profile.id },
    data: { [field]: list },
  });
  return true;
}
