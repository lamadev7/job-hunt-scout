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

export function evaluateTargetRole(p: Pick<
  StructuredProfile,
  "title" | "yearsExperience" | "skills" | "tools" | "roles"
>): string {
  // Weight role titles (working experience) and the current title heavier than
  // raw skills, then fold in skills/tools (major experience + projects).
  const titleText = [
    ...(p.roles ?? []).map((r) => r.title),
    p.title,
    p.title, // double-weight current title
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const skillText = [...(p.skills ?? []), ...(p.tools ?? [])].join(" ").toLowerCase();

  const scores = {} as Record<string, number>;
  for (const s of SIGNALS) {
    // title matches count double
    scores[s.family] = score(s.terms, skillText) + 2 * score(s.terms, titleText);
  }

  const fe = scores.Frontend ?? 0;
  const be = scores.Backend ?? 0;
  const devops = scores.DevOps ?? 0;
  const data = scores.Data ?? 0;
  const mobile = scores.Mobile ?? 0;

  let family: Family;
  const ranked = ([
    ["Frontend", fe],
    ["Backend", be],
    ["DevOps", devops],
    ["Data", data],
    ["Mobile", mobile],
  ] as [Family, number][]).sort((a, b) => b[1] - a[1]);

  const [topFamily, topScore] = ranked[0];

  if (topScore === 0) {
    // Nothing recognized — keep the resume's own title if sensible, else generic.
    const t = (p.title ?? "").trim();
    return t || "Software Engineer";
  } else if (fe >= 2 && be >= 2) {
    family = "Full Stack";
  } else {
    family = topFamily;
  }

  const band = seniorityBand(p.yearsExperience ?? 0);
  return `${band} ${ROLE_LABEL[family]}`.trim();
}
