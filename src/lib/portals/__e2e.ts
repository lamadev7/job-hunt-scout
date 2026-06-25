import { prisma } from "@/lib/db";
import { makeGenericAdapter } from "@/lib/portals/generic";

// Usage: node --import tsx src/lib/portals/__e2e.ts <name> <label> <url>
const [, , name = "weworkremotely", label = "We Work Remotely", url = "https://weworkremotely.com/remote-jobs"] =
  process.argv;

async function main() {
  console.log(`\n=== E2E: ${label} (${url}) ===`);
  await prisma.portal.upsert({
    where: { name },
    create: { name, label, url, enabled: true },
    update: { url, label },
  });
  await prisma.portalRecipe.deleteMany({ where: { portal: name } }); // force a fresh LEARN

  console.log("  llm key present:", Boolean(process.env.ANTHROPIC_API_KEY));
  const adapter = makeGenericAdapter(name);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const run = async (tag: string) => {
    let n = 0;
    const t0 = Date.now();
    try {
      const jobs = await adapter.fetchJobs(
        { portals: [name], role: "software engineer", remoteOnly: true, since },
        {
          onStatus: (m) => console.log(`  [${tag}] STATUS:`, m),
          onJob: (j) => {
            n += 1;
            if (n <= 6) console.log(`  [${tag}] JOB#${n}: "${j.position}" @ ${j.company} | jd=${j.jd.length}ch | ${j.url}`);
          },
        }
      );
      console.log(`  [${tag}] RESULT: ${jobs.length} jobs in ${Math.round((Date.now() - t0) / 1000)}s\n`);
    } catch (e) {
      console.log(`  [${tag}] threw: ${(e as Error).message}\n`);
    }
  };

  await run("RUN1-learn");
  const recipe = await prisma.portalRecipe.findUnique({ where: { portal: name } });
  console.log("  SAVED RECIPE:", recipe ? JSON.stringify({ portal: recipe.portal, searchUrlTemplate: recipe.searchUrlTemplate, jobLinkRegex: recipe.jobLinkRegex, jdSelector: recipe.jdSelector, titleSelector: recipe.titleSelector, confidence: recipe.confidence, status: recipe.status }, null, 2) : "(none — blind scan)");
  console.log("");
  await run("RUN2-replay"); // should NOT print "Learning…" if a recipe was saved
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("E2E FATAL:", e);
  process.exit(1);
});
