import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

/**
 * Clean slate for personal data. Keeps the portals + job pool (the agent's
 * search universe) but removes the demo profile, uploaded files, applications,
 * and milestones — so Dashboard / History / Enhancer start empty until you
 * upload your own resume and run the agent.
 */
async function main() {
  console.log("Resetting personal data…");
  const a = await prisma.application.deleteMany();
  const m = await prisma.milestone.deleteMany();
  const f = await prisma.resumeFile.deleteMany();
  const p = await prisma.profile.deleteMany();
  console.log(`  applications: ${a.count}`);
  console.log(`  milestones:   ${m.count}`);
  console.log(`  resumeFiles:  ${f.count}`);
  console.log(`  profiles:     ${p.count}`);

  const jobs = await prisma.job.count();
  const portals = await prisma.portal.count();
  console.log(`  kept: ${jobs} jobs, ${portals} portals (search universe)`);
  console.log("Done. Upload a resume in My Details to begin.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
