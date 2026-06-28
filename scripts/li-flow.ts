/**
 * Full agent on real LinkedIn, the user's exact scenario: threshold 90, last 7
 * days, remote. Logged-in via .li-recon-profile. Shows det→judge→final per job
 * (AGENT_DEBUG) and what gets saved. Evidence for whether 90% matching works.
 *   AGENT_DEBUG=1 PORTAL_PROFILE_DIR=.li-recon-profile node --import tsx scripts/li-flow.ts [threshold]
 */
import { prisma } from "@/lib/db";
import { closeBrowser } from "@/lib/portals/browser";
import { runAgent, type AgentEvent } from "@/lib/agent/orchestrator";

const THRESHOLD = Number(process.argv[2] || 90);

(async () => {
  await prisma.portal.upsert({ where: { name: "linkedin" }, create: { name: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/jobs", enabled: true }, update: {} });
  // clear prior apps for this profile+portal so we see a clean run
  const ids = (await prisma.job.findMany({ where: { portal: "linkedin" }, select: { id: true } })).map((j) => j.id);
  await prisma.application.deleteMany({ where: { jobId: { in: ids } } });

  const ev: AgentEvent[] = [];
  const emit = (e: AgentEvent) => {
    ev.push(e);
    if (e.type === "status") console.log("  ·", e.message);
    else if (e.type === "match") console.log(`  ✅ MATCH ${e.match.matchPct}%  ${e.match.position}`);
    else if (e.type === "done") console.log("  🏁", JSON.stringify(e.summary));
    else if (e.type === "error") console.log("  ⚠️", e.message);
  };

  console.log(`\n=== runAgent linkedin | threshold ${THRESHOLD}% | last 7 days | remote ===`);
  const summary = await runAgent({ portals: ["linkedin"], role: "Full Stack Engineer", threshold: THRESHOLD, postedWithin: "7d", remoteOnly: true }, emit).catch((e) => { console.log("THREW:", e.message); return null; });

  const apps = await prisma.application.findMany({ where: { job: { portal: "linkedin" } }, orderBy: { matchPct: "desc" }, select: { matchPct: true, job: { select: { position: true } }, matchedTerms: true } });
  console.log(`\napplications saved (>=${THRESHOLD}%): ${apps.length}`);
  for (const a of apps.slice(0, 8)) console.log(`  ${a.matchPct}%  ${a.job.position.slice(0, 50)} | ${(a.matchedTerms as string[]).slice(0, 6).join(",")}`);
  console.log("summary:", JSON.stringify(summary));
  await closeBrowser();
  process.exit(0);
})();
