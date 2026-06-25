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

  const adapter = makeGenericAdapter(name);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let jobCount = 0;
  try {
    const jobs = await adapter.fetchJobs(
      { portals: [name], role: "software engineer", remoteOnly: true, since },
      {
        onStatus: (m) => console.log("  STATUS:", m),
        onJob: (j) => {
          jobCount += 1;
          console.log(`  JOB#${jobCount}: "${j.position}" @ ${j.company} | jd=${j.jd.length}ch | ${j.url}`);
        },
      }
    );
    console.log(`\n  RESULT: ${jobs.length} jobs scraped.`);
  } catch (e) {
    console.log(`\n  fetchJobs threw: ${(e as Error).message}`);
  }

  const recipe = await prisma.portalRecipe.findUnique({ where: { portal: name } });
  console.log("  LEARNED RECIPE:", recipe ? JSON.stringify({ ...recipe, id: undefined }, null, 2) : "(none — fell back to blind scan)");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("E2E FATAL:", e);
  process.exit(1);
});
