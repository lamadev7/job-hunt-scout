/**
 * E2E: prove a generic portal with NO recipe learns its feed route + filters from
 * a HOMEPAGE landing, saves a replayable step script, and that replay (no LLM)
 * finds real jobs. Run headless: PORTAL_HEADLESS=1 node --import tsx scripts/e2e-learn.ts [url]
 */
import { prisma } from "@/lib/db";
import { getPage, closeBrowser } from "@/lib/portals/browser";
import { learnRecipe } from "@/lib/portals/learn";
import { getAdapterFor } from "@/lib/portals/registry";
import type { SearchQuery } from "@/lib/portals/adapter";

const BASE = process.argv[2] || "https://weworkremotely.com/";
const NAME = process.argv[3] || "wwr-e2e";

const query: SearchQuery = {
  portals: [NAME],
  role: "Software Engineer",
  remoteOnly: true,
  since: new Date(Date.now() - 7 * 86_400_000).toISOString(),
};

const log = (m: string) => console.log(`  · ${m}`);

(async () => {
  // Fresh slate: portal row exists, recipe removed so we exercise LEARNING.
  await prisma.portal.upsert({
    where: { name: NAME },
    create: { name: NAME, label: NAME, url: BASE, enabled: true },
    update: { url: BASE },
  });
  await prisma.portalRecipe.deleteMany({ where: { portal: NAME } });
  await prisma.job.deleteMany({ where: { portal: NAME } });

  console.log(`\n=== PHASE 1: LEARN from landing ${BASE} ===`);
  const page = await getPage(NAME);
  const learned = await learnRecipe(NAME, BASE, page, query, { onStatus: log });
  if (!learned) {
    console.log("RESULT: ❌ learn FAILED (no recipe produced)");
    await closeBrowser();
    process.exit(1);
  }
  console.log("RESULT: ✅ learned recipe");
  console.log("  steps:", JSON.stringify(learned.recipe.steps, null, 1));
  console.log("  jobLinkRegex:", learned.recipe.jobLinkRegex);
  console.log("  selectors:", JSON.stringify({
    title: learned.recipe.titleSelector, company: learned.recipe.companySelector,
    jd: learned.recipe.jdSelector, posted: learned.recipe.postedSelector,
  }));
  console.log("  sampleUrl:", learned.sampleUrl);

  console.log(`\n=== PHASE 2: REPLAY saved steps (no LLM) ===`);
  // New adapter instance reads the recipe from disk and replays — no learning.
  const jobs = await getAdapterFor(NAME).fetchJobs(query, { onStatus: log });
  console.log(`RESULT: ${jobs.length ? "✅" : "❌"} replay found ${jobs.length} job(s)`);
  for (const j of jobs.slice(0, 5)) {
    console.log(`   - ${j.position} @ ${j.company} | jd ${j.jd.length}ch | ${j.url}`);
  }

  await closeBrowser();
  const ok = Boolean(learned) && jobs.length > 0;
  console.log(`\n=== GOAL ${ok ? "ACHIEVED ✅" : "NOT MET ❌"} ===`);
  process.exit(ok ? 0 : 1);
})();
