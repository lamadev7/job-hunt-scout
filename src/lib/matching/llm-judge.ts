import { z } from "zod";
import { askJson, aiExtractionAvailable } from "@/lib/llm/client";
import type { StructuredProfile } from "@/lib/types";

/**
 * LLM-based match judge. The deterministic engine (engine.ts) is provable but
 * literal: it can't tell a "certification" from a skill, can't read "U.S.
 * citizenship required" as a hard blocker, and reasons about years only via a
 * regex. This judge reads the WHOLE JD against the WHOLE profile and returns a
 * calibrated, EXPLAINABLE verdict — grounded strictly in profile facts (it must
 * not credit skills the candidate doesn't list).
 *
 * It is the PRIMARY scorer for the single-JD co-pilot path; callers fall back to
 * the deterministic engine when no LLM is available or the output is malformed.
 */

export const judgementSchema = z.object({
  matchPct: z.number().min(0).max(100),
  verdict: z.string().default(""),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  // Hard disqualifiers the candidate cannot satisfy from their profile:
  // citizenship/clearance, a minimum years bar they don't meet, a mandatory
  // certification/degree they lack. Each is a short human-readable reason.
  blockers: z.array(z.string()).default([]),
  reasoning: z.string().default(""),
});
export type Judgement = z.infer<typeof judgementSchema> & { source: "llm" };

function buildPrompt(profile: StructuredProfile, jd: string, position?: string): string {
  const p = {
    title: profile.title,
    yearsExperience: profile.yearsExperience,
    skills: profile.skills,
    tools: profile.tools,
    domains: profile.domains,
    certifications: profile.certifications,
    summary: profile.summary,
  };
  return [
    `You are a rigorous technical recruiter. Score how well a CANDIDATE matches a JOB.`,
    `Return ONE JSON object, no prose, no code fences.`,
    ``,
    `JSON shape:`,
    `{`,
    `  "matchPct": 0-100 integer — honest fit against the job's REQUIRED qualifications,`,
    `  "verdict": "one short sentence",`,
    `  "matchedSkills": ["required things the candidate genuinely has"],`,
    `  "missingSkills": ["required things absent from the candidate profile"],`,
    `  "blockers": ["HARD disqualifiers the candidate cannot meet from their profile"],`,
    `  "reasoning": "2-3 sentences, grounded in the profile"`,
    `}`,
    ``,
    `Scoring rules — be strict and honest:`,
    `- Use ONLY facts in the candidate profile. Do NOT assume or invent skills, years, citizenship, certifications, or degrees not stated.`,
    `- A hard requirement the candidate cannot satisfy is a BLOCKER and MUST cap matchPct low (<=30): e.g. required citizenship/security clearance not stated, a minimum-years bar above the candidate's years, a MANDATORY certification or degree they lack.`,
    `- Distinguish a CERTIFICATION (e.g. "AWS certification") from merely using the tech (e.g. "AWS"). Having the skill does NOT satisfy a required certification.`,
    `- "Preferred"/"nice to have" items missing should lower the score only mildly, not block.`,
    `- If the candidate clearly meets the required skills AND the experience bar AND there are no blockers, the score should be high (>=85).`,
    `- matchPct must reflect REQUIRED-qualification coverage so a chosen threshold (e.g. 90%) is meaningful — never inflate.`,
    ``,
    `CANDIDATE PROFILE:`,
    JSON.stringify(p),
    ``,
    `JOB${position ? ` (${position})` : ""}:`,
    jd.slice(0, 12000),
  ].join("\n");
}

/** Returns a grounded judgement, or null if no LLM is available / output invalid. */
export async function judgeMatch(
  profile: StructuredProfile,
  jd: string,
  position?: string
): Promise<Judgement | null> {
  if (!jd.trim() || !(await aiExtractionAvailable())) return null;
  const raw = await askJson(buildPrompt(profile, jd, position), 1200);
  const parsed = judgementSchema.safeParse(raw);
  if (!parsed.success) return null;
  const j = parsed.data;
  // Safety net: if the model named blockers but still scored high, clamp — a
  // hard blocker must not read as a strong match regardless of skill overlap.
  const matchPct = j.blockers.length ? Math.min(j.matchPct, 30) : Math.round(j.matchPct);
  return { ...j, matchPct, source: "llm" };
}
