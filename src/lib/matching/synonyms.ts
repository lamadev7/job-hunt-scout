import { VOCAB } from "./vocab";

/**
 * Deterministic skill normalization. Maps common aliases to a canonical token
 * so "React.js", "ReactJS", "react" all collapse to "react". This is the only
 * "synonym" logic the matcher uses — no LLM guessing of numbers/terms.
 */
const ALIASES: Record<string, string> = {
  "react.js": "react",
  reactjs: "react",
  "node": "node.js",
  nodejs: "node.js",
  "node js": "node.js",
  "next": "next.js",
  nextjs: "next.js",
  js: "javascript",
  ts: "typescript",
  "type script": "typescript",
  golang: "go",
  k8s: "kubernetes",
  postgres: "postgresql",
  "postgre sql": "postgresql",
  psql: "postgresql",
  "rest api": "rest",
  "rest apis": "rest",
  "restful": "rest",
  "restful api": "rest",
  "restful apis": "rest",
  "rest services": "rest",
  "restful services": "rest",
  "graphql api": "graphql",
  "graphql apis": "graphql",
  "ci cd": "ci/cd",
  cicd: "ci/cd",
  "ci/cd pipelines": "ci/cd",
  "github action": "github actions",
  gha: "github actions",
  tf: "terraform",
  "amazon web services": "aws",
  gcp: "google cloud",
  "google cloud platform": "google cloud",
  "tailwind": "tailwind css",
  tailwindcss: "tailwind css",
  py: "python",
  ml: "machine learning",
  "scikit learn": "scikit-learn",
  sklearn: "scikit-learn",
};

export function canonical(skill: string): string {
  const key = skill.trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES[key] ?? key;
}

export function canonicalSet(skills: string[]): Set<string> {
  return new Set(skills.map(canonical));
}

// Canonical vocab terms, longest-name-first so multi-word terms ("tailwind css",
// "machine learning") are detected before their single-word fragments.
const VOCAB_TERMS = VOCAB.map((v) => ({ needle: v.name.toLowerCase(), canon: canonical(v.name) })).sort(
  (a, b) => b.needle.length - a.needle.length
);

function isWholeTerm(text: string, idx: number, len: number): boolean {
  const before = idx === 0 ? " " : text[idx - 1];
  const after = idx + len >= text.length ? " " : text[idx + len];
  const boundary = (c: string) => !/[a-z0-9.+#]/i.test(c);
  return boundary(before) && boundary(after);
}

/**
 * Build the set of skills a profile effectively "has", understanding free-text
 * English. Beyond aliasing, each skill phrase is scanned for any KNOWN vocab
 * term it contains as a whole word — so "REST APIs" covers "rest", "Node.js
 * development" covers "node.js", "experience with Docker & Kubernetes" covers
 * both. This is what lets the matcher compare loose resume wording against the
 * crisp skill tokens pulled from a job description.
 */
export function expandSkillSet(skills: string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of skills) {
    const lc = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!lc) continue;
    set.add(canonical(lc));
    for (const v of VOCAB_TERMS) {
      let from = 0;
      for (;;) {
        const idx = lc.indexOf(v.needle, from);
        if (idx === -1) break;
        if (isWholeTerm(lc, idx, v.needle.length)) {
          set.add(v.canon);
          break;
        }
        from = idx + v.needle.length;
      }
    }
  }
  return set;
}
