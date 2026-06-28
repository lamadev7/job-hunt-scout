/**
 * Canonical skill vocabulary with market-demand weights (0..1).
 * Used by the heuristic resume parser (keyword detection) and by the enhancer
 * to rank learning milestones. Demand values are static, curated estimates —
 * not LLM-generated — so milestone priority is reproducible.
 */
export type SkillCategory = "skill" | "tool" | "domain" | "certification";

export type VocabEntry = { name: string; category: SkillCategory; demand: number };

export const VOCAB: VocabEntry[] = [
  // languages / frameworks
  { name: "JavaScript", category: "skill", demand: 0.78 },
  { name: "TypeScript", category: "skill", demand: 0.9 },
  { name: "React", category: "skill", demand: 0.92 },
  { name: "Next.js", category: "skill", demand: 0.85 },
  { name: "Redux", category: "skill", demand: 0.55 },
  { name: "HTML", category: "skill", demand: 0.5 },
  { name: "CSS", category: "skill", demand: 0.5 },
  { name: "Tailwind CSS", category: "skill", demand: 0.7 },
  { name: "Node.js", category: "skill", demand: 0.86 },
  { name: "Python", category: "skill", demand: 0.9 },
  { name: "Go", category: "skill", demand: 0.85 },
  { name: "Java", category: "skill", demand: 0.7 },
  // .NET / Microsoft ecosystem
  { name: "C#", category: "skill", demand: 0.8 },
  { name: ".NET", category: "skill", demand: 0.82 },
  { name: "ASP.NET Core", category: "skill", demand: 0.7 },
  { name: "Blazor", category: "skill", demand: 0.5 },
  { name: "Entity Framework", category: "skill", demand: 0.55 },
  // other mainstream languages
  { name: "C++", category: "skill", demand: 0.68 },
  { name: "Rust", category: "skill", demand: 0.7 },
  { name: "Ruby", category: "skill", demand: 0.6 },
  { name: "Ruby on Rails", category: "skill", demand: 0.55 },
  { name: "PHP", category: "skill", demand: 0.5 },
  { name: "Laravel", category: "skill", demand: 0.5 },
  { name: "Kotlin", category: "skill", demand: 0.62 },
  { name: "Swift", category: "skill", demand: 0.6 },
  { name: "Scala", category: "skill", demand: 0.55 },
  { name: "Elixir", category: "skill", demand: 0.45 },
  // frontend frameworks
  { name: "Vue", category: "skill", demand: 0.72 },
  { name: "Angular", category: "skill", demand: 0.72 },
  { name: "Svelte", category: "skill", demand: 0.5 },
  // backend frameworks
  { name: "Express", category: "skill", demand: 0.62 },
  { name: "FastAPI", category: "skill", demand: 0.62 },
  { name: "Django", category: "skill", demand: 0.66 },
  { name: "Flask", category: "skill", demand: 0.55 },
  { name: "Spring", category: "skill", demand: 0.65 },
  // mobile
  { name: "React Native", category: "skill", demand: 0.66 },
  { name: "Flutter", category: "skill", demand: 0.6 },
  // AI / agents
  { name: "MCP", category: "skill", demand: 0.62 },
  { name: "RAG", category: "skill", demand: 0.66 },
  { name: "LLM", category: "skill", demand: 0.75 },
  { name: "LangChain", category: "skill", demand: 0.6 },
  { name: "NLP", category: "skill", demand: 0.66 },
  { name: "REST", category: "skill", demand: 0.65 },
  { name: "GraphQL", category: "skill", demand: 0.8 },
  { name: "gRPC", category: "skill", demand: 0.6 },
  { name: "PostgreSQL", category: "skill", demand: 0.82 },
  { name: "MongoDB", category: "skill", demand: 0.65 },
  { name: "Redis", category: "skill", demand: 0.68 },
  { name: "Kafka", category: "skill", demand: 0.7 },
  { name: "SQL", category: "skill", demand: 0.8 },
  { name: "Machine Learning", category: "skill", demand: 0.88 },
  { name: "TensorFlow", category: "skill", demand: 0.7 },
  { name: "PyTorch", category: "skill", demand: 0.78 },
  { name: "scikit-learn", category: "skill", demand: 0.6 },
  { name: "Pandas", category: "skill", demand: 0.62 },
  { name: "Spark", category: "skill", demand: 0.72 },
  { name: "Airflow", category: "skill", demand: 0.66 },
  { name: "dbt", category: "skill", demand: 0.64 },
  // tools / infra
  { name: "Docker", category: "tool", demand: 0.84 },
  { name: "Kubernetes", category: "tool", demand: 0.92 },
  { name: "Terraform", category: "tool", demand: 0.78 },
  { name: "AWS", category: "tool", demand: 0.9 },
  { name: "Azure", category: "tool", demand: 0.88 },
  { name: "Azure DevOps", category: "tool", demand: 0.6 },
  { name: "Google Cloud", category: "tool", demand: 0.72 },
  { name: "CI/CD", category: "tool", demand: 0.8 },
  { name: "GitHub Actions", category: "tool", demand: 0.66 },
  { name: "Git", category: "tool", demand: 0.6 },
  { name: "Jira", category: "tool", demand: 0.5 },
  { name: "RabbitMQ", category: "tool", demand: 0.55 },
  { name: "MySQL", category: "tool", demand: 0.6 },
  { name: "Elasticsearch", category: "tool", demand: 0.62 },
  { name: "Nginx", category: "tool", demand: 0.55 },
  { name: "Playwright", category: "tool", demand: 0.55 },
  { name: "Cypress", category: "tool", demand: 0.5 },
  { name: "Jest", category: "tool", demand: 0.55 },
  { name: "Linux", category: "tool", demand: 0.62 },
  { name: "Prometheus", category: "tool", demand: 0.6 },
  { name: "Grafana", category: "tool", demand: 0.58 },
  { name: "Helm", category: "tool", demand: 0.6 },
  { name: "Snowflake", category: "tool", demand: 0.7 },
];

export const VOCAB_BY_CANON = new Map(
  VOCAB.map((v) => [v.name.toLowerCase(), v])
);

export function demandFor(skill: string): number {
  return VOCAB_BY_CANON.get(skill.toLowerCase())?.demand ?? 0.5;
}

export function categoryFor(skill: string): SkillCategory {
  return VOCAB_BY_CANON.get(skill.toLowerCase())?.category ?? "skill";
}
