import type { MatchResult, StructuredProfile } from "@/lib/types";
import { clamp } from "@/lib/utils";
import { canonical, expandSkillSet } from "./synonyms";

export type JobLike = {
  requiredSkills: string[];
  niceSkills: string[];
  yearsRequired: number;
  applicantCount: number;
};

// Weights for the composite "fit / shortlist estimate" score.
const W = {
  mustHave: 0.5,
  niceHave: 0.2,
  years: 0.15,
  applicants: 0.15,
};

/**
 * Deterministic match scoring. The LLM never produces these numbers — they are
 * computed from set intersections so every percentage is provable + traceable.
 */
export function scoreJob(profile: StructuredProfile, job: JobLike): MatchResult {
  const have = expandSkillSet([...profile.skills, ...profile.tools, ...profile.domains]);

  const required = job.requiredSkills ?? [];
  const nice = job.niceSkills ?? [];

  const reqCanon = required.map((s) => ({ raw: s, c: canonical(s) }));
  const niceCanon = nice.map((s) => ({ raw: s, c: canonical(s) }));

  const reqMatched = reqCanon.filter((s) => have.has(s.c));
  const niceMatched = niceCanon.filter((s) => have.has(s.c));

  // Coverage is null when the JD lists no skills of that kind. We must NOT treat
  // "no required skills found" as full coverage — a non-tech JD (chef, recruiter)
  // extracts zero known skills and would otherwise score 100%. No recognized
  // skills at all => 0 (not a basis for a match).
  const reqCov = required.length ? reqMatched.length / required.length : null;
  const niceCov = nice.length ? niceMatched.length / nice.length : null;

  let skillScore: number; // 0..1
  if (reqCov !== null && niceCov !== null) skillScore = reqCov * 0.8 + niceCov * 0.2;
  else if (reqCov !== null) skillScore = reqCov;
  else if (niceCov !== null) skillScore = niceCov;
  else skillScore = 0;

  const mustHaveCoverage = reqCov ?? 0;
  const niceHaveCoverage = niceCov ?? 0;
  const matchPct = clamp(Math.round(skillScore * 100));

  // Years closeness: full credit at/above required, linear penalty below.
  const yearsMatch =
    job.yearsRequired <= 0
      ? 1
      : clamp(profile.yearsExperience / job.yearsRequired, 0, 1.2) > 1
        ? 1
        : clamp(profile.yearsExperience / job.yearsRequired, 0, 1);

  // Fewer applicants -> higher odds. Normalize against a 600 ceiling.
  const applicantFactor = clamp(1 - job.applicantCount / 600, 0, 1);

  // Fit blends skill coverage (dominant) with years + applicant pool. When no
  // skills match, skillScore is 0 so fit stays low — no false "great fit".
  const fitScore = clamp(
    Math.round((skillScore * 0.7 + yearsMatch * W.years + applicantFactor * W.applicants) * 100)
  );

  const matchedTerms = [...reqMatched, ...niceMatched].map((s) => s.raw);
  const missingTerms = [...reqCanon, ...niceCanon]
    .filter((s) => !have.has(s.c))
    .map((s) => s.raw);

  return {
    matchPct,
    fitScore,
    matchedTerms: dedupe(matchedTerms),
    missingTerms: dedupe(missingTerms),
    breakdown: { mustHaveCoverage, niceHaveCoverage, yearsMatch, applicantFactor },
  };
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}
