/**
 * Regression tests for profile↔JD matching honesty. No DB / browser / LLM.
 * Run: `node --import tsx src/lib/matching/matching.test.ts`
 *
 * Anchored on the real bug: a C#/.NET job scored 100% for a TS/React profile
 * because the .NET stack wasn't in the vocab (invisible requirements) and an
 * inline "preferred" demoted requirements to optional.
 */
import assert from "node:assert/strict";
import { extractJobSkills } from "./jd";
import { scoreJob, type JobLike } from "./engine";
import type { StructuredProfile } from "@/lib/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Parbat Lama — full-stack TS/React/Node, AI-agent dabbler. NO C#/.NET/Azure.
const profile: StructuredProfile = {
  fullName: "Parbat Lama",
  title: "Senior Full-Stack TypeScript Engineer",
  email: "",
  phone: "",
  summary: "",
  yearsExperience: 4,
  skills: ["TypeScript", "JavaScript", "Node.js", "Python", "React", "Next.js", "Express", "Hapi.js",
    "REST APIs", "GraphQL", "Microservices", "React Native", "FastAPI", "Socket.io", "MCP", "Claude Agents",
    "RAG", "AI AGENTS", "HTML", "CSS"],
  tools: ["MongoDB", "PostgreSQL", "MySQL", "Redis", "RabbitMQ", "AWS EC2", "AWS S3", "Docker", "Nginx",
    "CI/CD", "Git", "Github", "Jira"],
  domains: ["Logistics", "Agentic AI", "Full-Stack Web Development"],
  roles: [],
  education: [],
  certifications: [],
  rawText: "",
  confidence: 1,
  source: "confirmed",
};

const job = (jd: string, yearsRequired = 0): JobLike => {
  const { required, nice } = extractJobSkills(jd);
  return { requiredSkills: required, niceSkills: nice, yearsRequired, applicantCount: 0 };
};

// The real Mi-Case "AI Integration Specialist" JD (Required-Skills section).
const MICASE_JD = `
About the Role. You will build MCP server integrations connecting AI agents to Azure DevOps, GitHub,
Jira, and CI/CD pipelines, in a CJIS-compliant environment with Docker dev containers.
Required Skills
- Strong software engineering fundamentals — dive into complex backend code (C# / .NET preferred).
- Deep experience with AI coding agents such as Claude Code, GitHub Copilot, or similar.
- Strong working knowledge of the Microsoft / .NET ecosystem (C#, ASP.NET Core, Blazor, Entity Framework) and Azure DevOps.
- Experience with containerized or sandboxed development environments (Docker, dev containers).
- Comfortable across CI/CD, cloud infrastructure (Azure preferred), internal tooling, and application code.
`;

console.log("matching honesty");

test("Mi-Case .NET job: the .NET stack is now EXTRACTED as required (not invisible)", () => {
  const { required } = extractJobSkills(MICASE_JD);
  const canon = required.map((s) => s.toLowerCase());
  for (const must of ["c#", ".net", "asp.net core", "blazor", "entity framework", "azure"]) {
    assert.ok(canon.includes(must), `expected "${must}" in required, got: ${canon.join(", ")}`);
  }
});

test("Mi-Case .NET job does NOT score 100% for a TS/React profile (the bug)", () => {
  const result = scoreJob(profile, job(MICASE_JD, 2));
  console.log(`     matchPct=${result.matchPct}% matched=[${result.matchedTerms.join(", ")}]`);
  assert.ok(result.matchPct < 60, `expected a realistic (<60%) match, got ${result.matchPct}%`);
  // it should still credit the genuine AI/infra overlap, not zero it out
  const matched = result.matchedTerms.map((s) => s.toLowerCase());
  assert.ok(matched.includes("mcp") || matched.includes("docker") || matched.includes("ci/cd"),
    "expected genuine overlaps (MCP/Docker/CI-CD) to be credited");
});

test("missing C# / .NET / Azure are reported as gaps", () => {
  const result = scoreJob(profile, job(MICASE_JD, 2));
  const missing = result.missingTerms.map((s) => s.toLowerCase());
  for (const gap of ["c#", ".net", "azure"]) {
    assert.ok(missing.includes(gap), `expected "${gap}" in missingTerms, got: ${missing.join(", ")}`);
  }
});

test("inline 'preferred' does NOT demote the whole required list to nice-to-have", () => {
  const { required, nice } = extractJobSkills(MICASE_JD);
  // C# appears as "C# / .NET preferred" — must stay REQUIRED, not nice.
  assert.ok(required.map((s) => s.toLowerCase()).includes("c#"));
  assert.ok(!nice.map((s) => s.toLowerCase()).includes("c#"));
});

test("positive control: a TS/React/Node job scores HIGH for this profile", () => {
  const tsJob = `
  Required Skills
  - Strong TypeScript and JavaScript.
  - React and Next.js for the frontend.
  - Node.js with Express building REST APIs and GraphQL.
  - Docker and CI/CD.
  `;
  const result = scoreJob(profile, job(tsJob, 3));
  console.log(`     matchPct=${result.matchPct}% matched=[${result.matchedTerms.join(", ")}]`);
  assert.ok(result.matchPct >= 90, `expected a strong (>=90%) match, got ${result.matchPct}%`);
});

test("honesty: match% == required-skill coverage when years are met", () => {
  // 4 of 4 required present, none missing, experience met => 100%.
  const allPresent = `Required Skills: TypeScript, React, Node.js, Docker.`;
  assert.equal(scoreJob(profile, job(allPresent, 2)).matchPct, 100);
  // 2 of 4 present (TS, React) , 2 missing (Rust, Kotlin) => 50%.
  const half = `Required Skills: TypeScript, React, Rust, Kotlin.`;
  assert.equal(scoreJob(profile, job(half, 2)).matchPct, 50);
});

console.log(`\n${passed} passed`);
