/**
 * Evidence dump: why does matching score what it scores? For each real job in the
 * DB, show extracted required/nice skills, what the profile matched/missed, the
 * deterministic matchPct, and the years gap. Reveals whether low scores are fair
 * or a bug (e.g. over-extracting "required" skills).
 */
import { prisma } from "@/lib/db";
import { getActiveProfile, rowToStructured } from "@/lib/profile";
import { scoreJob } from "@/lib/matching/engine";
import { extractJobSkills } from "@/lib/matching/jd";
import { expandSkillSet } from "@/lib/matching/synonyms";

(async () => {
  const profile = rowToStructured((await getActiveProfile())!);
  const have = expandSkillSet([...profile.skills, ...profile.tools, ...profile.domains]);
  console.log("PROFILE:", profile.title, `(${profile.yearsExperience}y)`);
  console.log("  skills:", profile.skills.join(", "));
  console.log("  tools:", profile.tools.join(", "));
  console.log("  expanded set size:", have.size);

  const jobs = await prisma.job.findMany({ where: { portal: { in: ["linkedin", "discord-proof"] } }, orderBy: { postedAt: "desc" }, take: 12 });
  console.log(`\nauditing ${jobs.length} jobs:\n`);
  const dist: number[] = [];
  for (const j of jobs) {
    // re-extract from JD so we see exactly what the matcher derives now
    const { required, nice } = extractJobSkills(j.jd);
    const r = scoreJob(profile, { requiredSkills: required, niceSkills: nice, yearsRequired: j.yearsRequired, applicantCount: j.applicantCount });
    dist.push(r.matchPct);
    console.log(`■ ${r.matchPct}%  ${j.position.slice(0, 50)}  [${j.portal}]`);
    console.log(`   yearsReq=${j.yearsRequired} vs have ${profile.yearsExperience}  | reqCount=${required.length} niceCount=${nice.length}`);
    console.log(`   REQUIRED: ${required.join(", ") || "(none)"}`);
    console.log(`   matched : ${r.matchedTerms.join(", ") || "(none)"}`);
    console.log(`   missing : ${r.missingTerms.join(", ") || "(none)"}`);
    console.log("");
  }
  dist.sort((a, b) => b - a);
  console.log("matchPct distribution (desc):", dist.join(", "));
  console.log("max:", dist[0], "| #>=90:", dist.filter((x) => x >= 90).length, "| #>=70:", dist.filter((x) => x >= 70).length, "| #>=50:", dist.filter((x) => x >= 50).length);
  process.exit(0);
})();
