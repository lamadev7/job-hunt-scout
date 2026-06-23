import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveProfile, rowToStructured } from "@/lib/profile";
import { extractJobSkills } from "@/lib/matching/jd";
import { scoreJob } from "@/lib/matching/engine";
import { wordSuggestions } from "@/lib/llm/client";

export const runtime = "nodejs";
export const maxDuration = 60;

// Permissive CORS so the browser extension (any origin) can call this directly.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const schema = z.object({
  jd: z.string().min(1),
  position: z.string().optional(),
  company: z.string().optional(),
});

function parseYears(jd: string): number {
  const m = jd.match(/(\d{1,2})\+?\s*years?/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Co-pilot scoring: the extension sends the JD text from the page the user is
 * viewing; we score it against the active profile using the SAME deterministic
 * engine the agent uses. No scraping, no bot — the user is browsing normally.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a job description." }, { status: 400, headers: CORS });
  }
  const row = await getActiveProfile();
  if (!row) {
    return NextResponse.json({ error: "No active profile. Upload a resume first." }, { status: 400, headers: CORS });
  }
  const profile = rowToStructured(row);
  const { jd, position } = parsed.data;
  const { required, nice } = extractJobSkills(jd);

  const result = scoreJob(profile, {
    requiredSkills: required,
    niceSkills: nice,
    yearsRequired: parseYears(jd),
    applicantCount: 0, // unknown from a raw page; fit uses skills+years only here
  });

  const suggestions = await wordSuggestions(result.missingTerms, position || "this role");

  return NextResponse.json(
    {
      matchPct: result.matchPct,
      fitScore: result.fitScore,
      matchedTerms: result.matchedTerms,
      missingTerms: result.missingTerms,
      experience: result.experience,
      requiredSkills: required,
      niceSkills: nice,
      suggestions,
      profile: { fullName: profile.fullName, title: profile.title },
    },
    { headers: CORS }
  );
}
