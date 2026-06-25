import { prisma } from "@/lib/db";
import { runAgent, type AgentEvent } from "@/lib/agent/orchestrator";
import { recomputeMilestones } from "@/lib/agent/milestones";

const PORTALS = [
  { name: "gh-gitlab", label: "GitLab", url: "https://job-boards.greenhouse.io/gitlab" },
  { name: "gh-figma", label: "Figma", url: "https://job-boards.greenhouse.io/figma" },
];
const NAMES = PORTALS.map((p) => p.name);

async function setup() {
  for (const p of PORTALS) {
    await prisma.portal.upsert({ where: { name: p.name }, create: { ...p, enabled: true }, update: { url: p.url, label: p.label } });
  }
  // Fresh: no recipes, no prior test apps/jobs (so RUN1 truly learns + RUN2 proves memory).
  const jobs = await prisma.job.findMany({ where: { portal: { in: NAMES } }, select: { id: true } });
  await prisma.application.deleteMany({ where: { jobId: { in: jobs.map((j) => j.id) } } });
  await prisma.job.deleteMany({ where: { portal: { in: NAMES } } });
  await prisma.portalRecipe.deleteMany({ where: { portal: { in: NAMES } } });
}

async function runOnce(tag: string) {
  let learned = false;
  const perPortalStatus: string[] = [];
  const summary = await runAgent(
    { portals: NAMES, role: "software engineer", threshold: 0, postedWithin: "30d" },
    (e: AgentEvent) => {
      if (e.type === "status") {
        if (/Learning|Testing learned/.test(e.message)) learned = true;
        if (/Found \d+ listings|Learned |recipe stale|generic mode/.test(e.message)) perPortalStatus.push(e.message);
      }
    }
  );
  console.log(`\n[${tag}] evaluated=${summary.evaluated} matched(>=0)=${summary.matched} skipped=${summary.skipped} errors=${summary.errors.length} | LLM-learning-happened=${learned}`);
  perPortalStatus.slice(0, 8).forEach((s) => console.log(`   · ${s}`));
  summary.errors.forEach((e) => console.log(`   ! ${e}`));
  return summary;
}

async function showRecipes() {
  const rs = await prisma.portalRecipe.findMany({ where: { portal: { in: NAMES } } });
  console.log(`\nLEARNED RECIPES (agent's remembered search steps): ${rs.length}`);
  for (const r of rs) {
    console.log(`  ${r.portal}: status=${r.status} conf=${r.confidence}`);
    console.log(`     searchUrlTemplate = ${r.searchUrlTemplate || "(base url)"}`);
    console.log(`     jobLinkRegex      = ${r.jobLinkRegex}`);
    console.log(`     title/jd selector = ${r.titleSelector || "(heuristic)"} / ${r.jdSelector || "(heuristic)"}`);
  }
}

async function analyzeAccuracy() {
  const apps = await prisma.application.findMany({
    where: { job: { portal: { in: NAMES } } },
    include: { job: true },
    orderBy: { matchPct: "desc" },
  });
  console.log(`\nMATCHING ACCURACY — ${apps.length} jobs scored vs profile (Parbat Lama, full-stack TS/React/Node):`);
  const fmt = (a: (typeof apps)[number]) => {
    const matched = (a.matchedTerms as string[]) ?? [];
    return `  ${String(a.matchPct).padStart(3)}%  ${a.job.position.slice(0, 52).padEnd(52)} [${matched.slice(0, 5).join(", ")}]`;
  };
  console.log(" TOP (should be eng-heavy):");
  apps.slice(0, 8).forEach((a) => console.log(fmt(a)));
  console.log(" BOTTOM (should be non-eng / low overlap):");
  apps.slice(-5).forEach((a) => console.log(fmt(a)));

  // crude accuracy signal: do "engineer/developer/software" titles outscore the rest?
  const eng = apps.filter((a) => /engineer|developer|software|frontend|backend|full.?stack|data/i.test(a.job.position));
  const non = apps.filter((a) => !/engineer|developer|software|frontend|backend|full.?stack|data/i.test(a.job.position));
  const avg = (xs: typeof apps) => (xs.length ? Math.round(xs.reduce((s, a) => s + a.matchPct, 0) / xs.length) : 0);
  console.log(`\n SIGNAL: avg match — engineering titles=${avg(eng)}% (n=${eng.length}) vs other=${avg(non)}% (n=${non.length})`);
}

async function cleanup() {
  const jobs = await prisma.job.findMany({ where: { portal: { in: NAMES } }, select: { id: true } });
  await prisma.application.deleteMany({ where: { jobId: { in: jobs.map((j) => j.id) } } });
  await prisma.job.deleteMany({ where: { portal: { in: NAMES } } });
  await prisma.portalRecipe.deleteMany({ where: { portal: { in: NAMES } } });
  await prisma.portal.deleteMany({ where: { name: { in: NAMES } } });
  await recomputeMilestones(); // restore the user's milestone state after removing test apps
  console.log("\ncleanup done.");
}

async function main() {
  console.log("=== FULL E2E: real runAgent + real profile + 2 portals (GitLab, Figma) ===");
  await setup();
  await runOnce("RUN1 (learn)");
  await showRecipes();
  await analyzeAccuracy();
  const r2 = await runOnce("RUN2 (memory — expect LLM-learning-happened=false, evaluated≈0 all-seen)");
  await cleanup();
  console.log(`\nMEMORY VERDICT: run2 re-learned? ${r2.evaluated > 0 ? "?" : "NO (reused saved recipes, all jobs already seen)"}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error("E2E FATAL:", e); process.exit(1); });
