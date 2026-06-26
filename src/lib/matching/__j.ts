import { judgeMatch } from "./llm-judge";
import type { StructuredProfile } from "@/lib/types";
const p = { fullName:"Parbat Lama", title:"Senior Full-Stack TypeScript Engineer", email:"", phone:"", summary:"Full-stack TS engineer, React/Next/Node, some AI agents (MCP, RAG, Claude).", yearsExperience:4,
  skills:["TypeScript","React","Next.js","Node.js","Python","MCP","RAG","GraphQL","REST APIs"], tools:["AWS EC2","AWS S3","Docker","CI/CD","Git","MongoDB","PostgreSQL"],
  domains:["Logistics","Agentic AI"], roles:[], education:[{degree:"BSc",field:"IT",institution:"Herald"}], certifications:[], rawText:"", confidence:1, source:"confirmed" } as StructuredProfile;
const jd = `Qualifications You Must Have
University degree or equivalent and 8+ years of relevant experience OR Advanced degree and 5+ years.
At least 8 years of software engineering experience. U.S. citizenship is required.
Qualifications We Prefer
Serverless patterns. AWS certification. Agile. Aerospace and defense industry.`;
(async () => {
  const j = await judgeMatch(p, jd, "Senior Software Engineer");
  console.log(j ? JSON.stringify(j, null, 2) : "NULL (no LLM / invalid)");
})().catch(e=>{console.error("FAIL:",e);process.exit(1);});
