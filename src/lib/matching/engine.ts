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

  // Overall coverage across ALL extracted skills (deduped). The required/nice
  // split is heuristic and sometimes mislabels (e.g. tags "Machine Learning" as
  // the sole required while the real stack lands under nice); overall coverage
  // is a robust cushion so a candidate who matches most of the JD's tech isn't
  // buried by one misclassified term.
  const allCanon = new Set([...reqCanon, ...niceCanon].map((s) => s.c));
  const matchedCanon = new Set([...reqMatched, ...niceMatched].map((s) => s.c));
  const overallCov = allCanon.size ? matchedCanon.size / allCanon.size : null;

  // Required-led score where nice-to-haves are a BONUS, never a penalty: meeting
  // all the REQUIRED skills alone is already a strong match (~0.9), and matching
  // nice-to-haves on top lifts it toward 1.0. (The old reqCov*0.8 + niceCov*0.2
  // capped a perfect required match at 80% whenever nice-to-haves were absent.)
  let reqLed: number | null = null;
  if (reqCov !== null && niceCov !== null) reqLed = reqCov * 0.9 + niceCov * 0.1;
  else if (reqCov !== null) reqLed = reqCov;
  else if (niceCov !== null) reqLed = niceCov;

  let skillScore: number; // 0..1
  if (reqLed !== null && overallCov !== null) skillScore = Math.max(reqLed, overallCov * 0.9);
  else if (reqLed !== null) skillScore = reqLed;
  else if (overallCov !== null) skillScore = overallCov;
  else skillScore = 0;

  const mustHaveCoverage = reqCov ?? 0;
  const niceHaveCoverage = niceCov ?? 0;

  // Experience fit tempers the headline match but must NOT annihilate a strong
  // skill match — a years shortfall is a soft signal here (the LLM judge enforces
  // hard minimum-years blockers precisely). Floor the multiplier so skills still
  // show through; a real shortfall caps the score well under a 90% bar but not 0.
  const exp = experienceFit(profile.yearsExperience, job.yearsRequired);
  const yearsMatch = exp.fit;
  const effectiveFit = 0.6 + 0.4 * exp.fit;

  // Match % = skill coverage tempered by experience fit. Zero skills => still 0.
  const matchPct = clamp(Math.round(skillScore * effectiveFit * 100));

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
