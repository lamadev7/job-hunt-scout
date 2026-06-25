import { prisma } from "@/lib/db";
import { makeGenericAdapter } from "@/lib/portals/generic";
(async () => {
  const name = "greenhouse-airbnb";
  const adapter = makeGenericAdapter(name);
  const t0 = Date.now(); let n = 0; let sawLearning = false;
  const jobs = await adapter.fetchJobs(
    { portals: [name], role: "engineer", remoteOnly: true, since: new Date(Date.now()-30*864e5).toISOString() },
    { onStatus: m => { if(/Learning|Testing/.test(m)) sawLearning = true; console.log("  STATUS:", m); },
      onJob: j => { n++; if(n<=5) console.log(`  JOB#${n}: "${j.position}" | jd=${j.jd.length}ch | ${j.url}`); } }
  );
  console.log(`\n  REPLAY: ${jobs.length} jobs in ${Math.round((Date.now()-t0)/1000)}s | re-learned? ${sawLearning}`);
  await prisma.$disconnect();
})().catch(e => { console.error("FAIL:", e); process.exit(1); });
