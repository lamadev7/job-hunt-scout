import { prisma } from "@/lib/db";
import { makeGenericAdapter } from "@/lib/portals/generic";
const name = "gh-gitlab";
(async () => {
  await prisma.portal.upsert({ where:{name}, create:{name,label:"GitLab",url:"https://job-boards.greenhouse.io/gitlab",enabled:true}, update:{} });
  await prisma.portalRecipe.deleteMany({ where:{portal:name} });
  const a = makeGenericAdapter(name); let learned=false, blind=false, n=0;
  await a.fetchJobs({ portals:[name], role:"software engineer", remoteOnly:true, since:new Date(Date.now()-30*864e5).toISOString() },
    { onStatus:m=>{ if(/Learning|Testing learned/.test(m))learned=true; if(/generic mode/.test(m))blind=true; }, onJob:()=>{n++;} });
  const r = await prisma.portalRecipe.findUnique({ where:{portal:name} });
  console.log(`FIRST-RUN: jobs=${n} attemptedLearn=${learned} fellToBlind=${blind} recipeSaved=${!!r}`);
  if(r) console.log(`  regex=${r.jobLinkRegex} | searchTpl=${r.searchUrlTemplate||"(base)"} | conf=${r.confidence}`);
  const jobs = await prisma.job.findMany({ where:{portal:name}, select:{id:true} });
  await prisma.application.deleteMany({ where:{jobId:{in:jobs.map(j=>j.id)}} });
  await prisma.job.deleteMany({ where:{portal:name} }); await prisma.portalRecipe.deleteMany({ where:{portal:name} }); await prisma.portal.deleteMany({ where:{name} });
  await prisma.$disconnect();
})().catch(e=>{console.error("FAIL:",e);process.exit(1);});
