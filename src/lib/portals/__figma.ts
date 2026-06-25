import { prisma } from "@/lib/db";
import { makeGenericAdapter } from "@/lib/portals/generic";
const name = "gh-figma";
async function run(tag: string) {
  const a = makeGenericAdapter(name); let learned = false, n = 0;
  await a.fetchJobs({ portals:[name], role:"engineer", remoteOnly:true, since:new Date(Date.now()-30*864e5).toISOString() },
    { onStatus: m => { if(/Learning|Testing learned/.test(m)) learned = true; },
      onJob: () => { n++; } });
  console.log(`[${tag}] jobs=${n} re-learned=${learned}`);
}
(async () => {
  await prisma.portal.upsert({ where:{name}, create:{name,label:"Figma",url:"https://job-boards.greenhouse.io/figma",enabled:true}, update:{} });
  await prisma.portalRecipe.deleteMany({ where:{portal:name} });
  await run("LEARN");
  const r = await prisma.portalRecipe.findUnique({ where:{portal:name} });
  console.log("RECIPE:", r ? r.jobLinkRegex + " | status=" + r.status : "NONE (blind only)");
  await run("REPLAY");
  // cleanup
  const jobs = await prisma.job.findMany({ where:{portal:name}, select:{id:true} });
  await prisma.application.deleteMany({ where:{jobId:{in:jobs.map(j=>j.id)}} });
  await prisma.job.deleteMany({ where:{portal:name} });
  await prisma.portalRecipe.deleteMany({ where:{portal:name} });
  await prisma.portal.deleteMany({ where:{name} });
  await prisma.$disconnect();
})().catch(e => { console.error("FAIL:", e); process.exit(1); });
