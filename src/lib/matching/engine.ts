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

// Experience-fit tuning. Years on the job is a primary screen in most hiring
// funnels, so a real shortfall must pull the headline match down — not just the
// soft fit estimate.
//   - meet or exceed the ask          => full credit
//   - stretch up to TOLERANCE under   => still full credit (4y candidate vs a
//                                        5y ask is realistic, recruiters accept it)
//   - beyond that                     => linear decay; each extra year of gap
//                                        past tolerance costs 1/DECAY of the score
const YEARS_TOLERANCE = 1;
const YEARS_DECAY = 3;

/**
 * Deterministic experience fit (0..1). `meets` is the human verdict used for the
 * "matching / not matching" criteria; `fit` is the multiplier applied to the
 * match score. Over-qualification is never penalized.
 */
export function experienceFit(
  have: number,
  required: number
): { fit: number; meets: boolean; gap: number } {
  if (!required || required <= 0) return { fit: 1, meets: true, gap: 0 };
  const gap = required - have; // positive => under-qualified
  if (gap <= YEARS_TOLERANCE) return { fit: 1, meets: true, gap: Math.max(0, gap) };
  const fit = clamp(1 - (gap - YEARS_TOLERANCE) / YEARS_DECAY, 0, 1);
  return { fit, meets: false, gap };
}

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

  // Experience fit folds into the headline match — a strong skill match for a
  // role that wants years you don't have is NOT a 100% match. Tolerance-aware so
  // a realistic stretch isn't punished.
  const exp = experienceFit(profile.yearsExperience, job.yearsRequired);
  const yearsMatch = exp.fit;

  // Match % = skill coverage tempered by experience fit. Zero skills => still 0.
  const matchPct = clamp(Math.round(skillScore * exp.fit * 100));

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
    experience:
      job.yearsRequired > 0
        ? {
            required: job.yearsRequired,
            have: profile.yearsExperience,
            meets: exp.meets,
            fit: exp.fit,
          }
        : null,
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
