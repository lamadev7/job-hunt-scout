import type { StructuredProfile } from "@/lib/types";

/**
 * Deterministic "target role" evaluation, run right after a resume is parsed.
 * Grounds the suggestion in three signals from the extracted profile:
 *  - major experience / projects  → skills + tools
 *  - working experience           → past role titles (weighted)
 *  - seniority                    → total years of experience
 * No LLM call — always available, identical output for identical input.
 */

type Family = "Frontend" | "Backend" | "Full Stack" | "DevOps" | "Data" | "Mobile" | "Software";

const SIGNALS: { family: Exclude<Family, "Full Stack" | "Software">; terms: string[] }[] = [
  { family: "Frontend", terms: ["react", "next.js", "vue", "angular", "svelte", "redux", "tailwind", "css", "html", "javascript", "typescript"] },
  { family: "Backend", terms: ["node.js", "express", "python", "django", "flask", "go", "golang", "java", "spring", "ruby", "rails", "php", "laravel", ".net", "c#", "postgresql", "mysql", "mongodb", "redis", "graphql", "grpc", "rest", "kafka"] },
  { family: "DevOps", terms: ["aws", "gcp", "azure", "docker", "kubernetes", "terraform", "ansible", "ci/cd", "jenkins", "prometheus", "grafana", "helm", "linux"] },
  { family: "Data", terms: ["pandas", "spark", "airflow", "dbt", "snowflake", "tensorflow", "pytorch", "scikit-learn", "hadoop", "tableau", "etl", "numpy", "sql"] },
  { family: "Mobile", terms: ["swift", "kotlin", "react native", "flutter", "android", "ios", "objective-c"] },
];

const ROLE_LABEL: Record<Family, string> = {
  Frontend: "Frontend Engineer",
  Backend: "Backend Engineer",
  "Full Stack": "Full Stack Engineer",
  DevOps: "DevOps Engineer",
  Data: "Data Engineer",
  Mobile: "Mobile Engineer",
  Software: "Software Engineer",
};

function seniorityBand(years: number): string {
  if (!years || years < 2) return years >= 1 ? "Junior" : "";
  if (years < 5) return ""; // Mid — conventionally unprefixed
  if (years < 8) return "Senior";
  return "Lead";
}

/** Count how many family terms appear as whole tokens in the haystack. */
function score(terms: string[], haystack: string): number {
  return terms.reduce((n, term) => (haystack.includes(term) ? n + 1 : n), 0);
}

/** Which family terms actually appeared (for human-readable reasons). */
function matchedTerms(terms: string[], haystack: string): string[] {
  return terms.filter((t) => haystack.includes(t));
}

type ProfileForEval = Pick<StructuredProfile, "title" | "yearsExperience" | "skills" | "tools" | "roles">;

function haystacks(p: ProfileForEval) {
  const titleText = [...(p.roles ?? []).map((r) => r.title), p.title, p.title]
    .filter(Boolean).join(" ").toLowerCase();
  const skillText = [...(p.skills ?? []), ...(p.tools ?? [])].join(" ").toLowerCase();
  return { titleText, skillText };
}

/** Per-family weighted scores (title matches count double). Shared by the single
 *  target-role pick and the multi-role recommender so they stay consistent. */
function familyScores(p: ProfileForEval): Record<string, { score: number; terms: string[] }> {
  const { titleText, skillText } = haystacks(p);
  const out: Record<string, { score: number; terms: string[] }> = {};
  for (const s of SIGNALS) {
    out[s.family] = {
      score: score(s.terms, skillText) + 2 * score(s.terms, titleText),
      terms: [...new Set([...matchedTerms(s.terms, skillText), ...matchedTerms(s.terms, titleText)])],
    };
  }
  return out;
}

export type RecommendedRole = { title: string; family: Family; score: number; reason: string };

/**
 * Recommend a RANKED list of suitable job titles from the profile — deterministic
 * (no LLM): family signal strength + a Full-Stack pick when both front and back
 * are strong, seniority-banded by years. Each carries a templated reason naming
 * the stack that drove it; an LLM can rewrite these reasons later for nicer UX.
 */
export function recommendRoles(p: ProfileForEval, max = 5): RecommendedRole[] {
  const fam = familyScores(p);
  const band = seniorityBand(p.yearsExperience ?? 0);
  const label = (f: Family) => `${band} ${ROLE_LABEL[f]}`.trim();
  const reasonFor = (terms: string[]) =>
    terms.length ? `Matches your ${terms.slice(0, 4).join(", ")}` : "Based on your overall profile";

  const out: RecommendedRole[] = [];
  const fe = fam.Frontend?.score ?? 0;
  const be = fam.Backend?.score ?? 0;

  // Full Stack first when both sides are genuinely present.
  if (fe >= 2 && be >= 2) {
    out.push({
      title: label("Full Stack"),
      family: "Full Stack",
      score: fe + be,
      reason: reasonFor([...(fam.Frontend?.terms ?? []).slice(0, 2), ...(fam.Backend?.terms ?? []).slice(0, 2)]),
    });
  }
  // Then each individual family with real signal, ranked by score.
  const ranked = (Object.keys(fam) as Family[])
    .map((f) => ({ f, ...fam[f] }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  for (const { f, score: sc, terms } of ranked) {
    if (out.some((r) => r.family === f)) continue;
    out.push({ title: label(f), family: f, score: sc, reason: reasonFor(terms) });
  }
  // Always offer a safe generic fallback so the list is never empty.
  if (!out.length) {
    const t = (p.title ?? "").trim() || ROLE_LABEL.Software;
    out.push({ title: t, family: "Software", score: 0, reason: "A broad default from your profile" });
  }
  return out.slice(0, max);
}

/** The single best target role — the top recommendation (kept for back-compat). */
export function evaluateTargetRole(p: ProfileForEval): string {
  return recommendRoles(p, 1)[0]?.title || (p.title ?? "").trim() || ROLE_LABEL.Software;
}
