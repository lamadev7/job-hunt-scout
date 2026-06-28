/**
 * Full-flow e2e: drive the REAL agent (orchestrator.runAgent) against a clean
 * no-login board and observe the whole pipeline — scan → learn/replay → score →
 * LLM judge (jobs over threshold) → save Applications → milestones.
 *   PORTAL_HEADLESS=1 node --import tsx scripts/e2e-flow.ts
 */
import { prisma } from "@/lib/db";
import { closeBrowser } from "@/lib/portals/browser";
import { runAgent, type AgentEvent } from "@/lib/agent/orchestrator";

const NAME = "gh-flow";
const BASE = process.argv[2] || "https://job-boards.greenhouse.io/gitlab";
const ROLE = process.argv[3] || "Software Engineer";
const THRESHOLD = Number(process.argv[4] || 25);

(async () => {
  // Clean slate for this test portal (leave the user's real portals + apps alone).
  await prisma.portal.upsert({ where: { name: NAME }, create: { name: NAME, label: "GH Flow", url: BASE, enabled: true }, update: { url: BASE, enabled: true } });
  await prisma.portalRecipe.deleteMany({ where: { portal: NAME } });
  const jobIds = (await prisma.job.findMany({ where: { portal: NAME }, select: { id: true } })).map((j) => j.id);
  await prisma.application.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.job.deleteMany({ where: { portal: NAME } });

  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent) => {
    events.push(e);
    if (e.type === "status") console.log("  ·", e.message);
    else if (e.type === "match") console.log(`  ✅ MATCH ${e.match.matchPct}%  ${e.match.position} @ ${e.match.company}`);
    else if (e.type === "skip") console.log(`  ✗ skip ${e.matchPct}%  ${e.position}`);
    else if (e.type === "error") console.log("  ⚠️ ERROR", e.message);
    else if (e.type === "done") console.log("  🏁 DONE", JSON.stringify(e.summary));
  };

  console.log(`\n=== runAgent on ${NAME} (threshold ${THRESHOLD}%) ===`);
  let summary;
  try {
    summary = await runAgent(
      { portals: [NAME], roles: ROLE.split(",").map((s) => s.trim()).filter(Boolean), threshold: THRESHOLD, postedWithin: "30d", remoteOnly: true },
      emit
    );
  } catch (err) {
    console.log("runAgent THREW:", err instanceof Error ? err.message : err);
  }

  console.log("\n=== DB AFTER ===");
  const apps = await prisma.application.findMany({
    where: { job: { portal: NAME } },
    select: { matchPct: true, fitScore: true, status: true, applyState: true, matchedTerms: true, missingTerms: true, job: { select: { position: true, company: true, yearsRequired: true } } },
    orderBy: { matchPct: "desc" },
  });
  console.log(`applications saved: ${apps.length}`);
  for (const a of apps.slice(0, 8)) {
    console.log(`  ${a.matchPct}% fit${a.fitScore} [${a.applyState}] ${a.job.position} @ ${a.job.company} | matched=${(a.matchedTerms as string[]).slice(0,6).join(",")}`);
  }
  const milestones = await prisma.milestone?.count?.().catch(() => -1);
  console.log("milestones:", milestones);

  await closeBrowser();
  const skips = events.filter((e) => e.type === "skip").length;
  const errs = events.filter((e) => e.type === "error").length;
  console.log(`\n=== events: ${events.length} | matches ${events.filter(e=>e.type==='match').length} | skips ${skips} | errors ${errs} ===`);
  console.log(summary ? "summary: " + JSON.stringify(summary) : "no summary (threw)");
  process.exit(0);
})();
