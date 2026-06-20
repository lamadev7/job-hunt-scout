import { prisma } from "@/lib/db";
import { clamp } from "@/lib/utils";
import { demandFor } from "@/lib/matching/vocab";
import { getActiveProfile, rowToStructured } from "@/lib/profile";

export type StrengthCard = {
  key: string;
  label: string;
  value: number; // 0..100 achieved
  total: 100;
  detail: string;
};

/** Computed resume-strength metrics (all deterministic, no LLM numbers). */
export async function getStrength(): Promise<{ cards: StrengthCard[]; overall: number }> {
  const row = await getActiveProfile();
  if (!row) {
    return { cards: [], overall: 0 };
  }
  const p = rowToStructured(row);
  const allSkills = [...p.skills, ...p.tools];

  // 1. Skill breadth — distinct skills toward a target of 20.
  const breadth = clamp(Math.round((allSkills.length / 20) * 100));

  // 2. Market alignment — average market demand of listed skills.
  const alignment = allSkills.length
    ? clamp(Math.round((allSkills.reduce((s, k) => s + demandFor(k), 0) / allSkills.length) * 100))
    : 0;

  // 3. Experience depth — years toward an 8-year senior band.
  const depth = clamp(Math.round((p.yearsExperience / 8) * 100));

  // 4. Profile completeness — key fields present.
  const fields = [
    p.fullName,
    p.title,
    p.email,
    p.summary,
    allSkills.length ? "x" : "",
    p.roles.length ? "x" : "",
    p.education.length ? "x" : "",
    p.certifications.length ? "x" : "",
  ];
  const completeness = clamp(Math.round((fields.filter(Boolean).length / fields.length) * 100));

  // 5. Match strength — average match% across the user's applications.
  const apps = await prisma.application.findMany({ select: { matchPct: true } });
  const matchStrength = apps.length
    ? clamp(Math.round(apps.reduce((s, a) => s + a.matchPct, 0) / apps.length))
    : 0;

  // 6. Skill gap closure — completed milestones / total.
  const [done, totalMs] = await Promise.all([
    prisma.milestone.count({ where: { done: true } }),
    prisma.milestone.count(),
  ]);
  const gapClosure = totalMs ? clamp(Math.round((done / totalMs) * 100)) : 0;

  const cards: StrengthCard[] = [
    { key: "match", label: "Match Strength", value: matchStrength, total: 100, detail: `Avg match across ${apps.length} applications` },
    { key: "alignment", label: "Market Alignment", value: alignment, total: 100, detail: "Demand-weighted skill relevance" },
    { key: "breadth", label: "Skill Breadth", value: breadth, total: 100, detail: `${allSkills.length} distinct skills` },
    { key: "depth", label: "Experience Depth", value: depth, total: 100, detail: `${p.yearsExperience} yrs vs senior band` },
    { key: "completeness", label: "Profile Completeness", value: completeness, total: 100, detail: "Key resume fields filled" },
    { key: "gap", label: "Gap Closure", value: gapClosure, total: 100, detail: `${done}/${totalMs} milestones done` },
  ];

  const overall = Math.round(cards.reduce((s, c) => s + c.value, 0) / cards.length);
  return { cards, overall };
}
