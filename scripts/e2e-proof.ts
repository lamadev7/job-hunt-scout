/**
 * VISUAL proof: open a portal, navigate to the filtered feed, open a job post,
 * score it — capturing a screenshot at every stage so we can SEE it really runs
 * in a browser. Also audits exactly which filters made it into the feed URL.
 *   PORTAL_HEADLESS=1 node --import tsx scripts/e2e-proof.ts
 */
import { prisma } from "@/lib/db";
import { getPage, screenshot, closeBrowser } from "@/lib/portals/browser";
import { learnRecipe } from "@/lib/portals/learn";
import { loadRecipe } from "@/lib/portals/recipe-store";
import { replaySteps } from "@/lib/portals/steps";
import { harvestJobLinks, scrapeDetail } from "@/lib/portals/scrape";
import { extractJobSkills } from "@/lib/matching/jd";
import { scoreJob } from "@/lib/matching/engine";
import { getActiveProfile, rowToStructured } from "@/lib/profile";
import type { SearchQuery } from "@/lib/portals/adapter";

const NAME = "discord-proof";
const BASE = "https://job-boards.greenhouse.io/discord";
const query: SearchQuery = { portals: [NAME], role: "Full Stack", remoteOnly: true, location: "Remote", since: new Date(Date.now() - 30 * 86_400_000).toISOString() };

const shots: string[] = [];
const snap = async (page: any, label: string) => { const s = await screenshot(page, label); shots.push(s); console.log(`  📸 ${label} -> ${s}`); };

(async () => {
  const profRow = await getActiveProfile();
  const profile = rowToStructured(profRow!);
  await prisma.portal.upsert({ where: { name: NAME }, create: { name: NAME, label: NAME, url: BASE, enabled: true }, update: { url: BASE } });
  await prisma.portalRecipe.deleteMany({ where: { portal: NAME } });

  const page = await getPage(NAME);

  console.log("\n[1] OPEN PORTAL");
  await page.goto(BASE, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log("   landed:", page.url());
  await snap(page, "proof-1-portal-open");

  console.log("\n[2] LEARN recipe (find feed + filters)");
  const learned = await learnRecipe(NAME, BASE, page, query, { onStatus: (m) => console.log("   ·", m) });
  if (!learned) { console.log("   ❌ learn failed"); await closeBrowser(); process.exit(1); }
  console.log("   steps:", JSON.stringify(learned.recipe.steps));

  console.log("\n[3] REPLAY steps -> FILTERED FEED (the apply-filter step)");
  await page.goto(BASE, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await replaySteps(page, learned.recipe.steps, BASE, query);
  const feedUrl = page.url();
  console.log("   feed url:", feedUrl);
  // Audit which filters actually made it into the URL.
  const params = (() => { try { return [...new URL(feedUrl).searchParams.entries()]; } catch { return []; } })();
  console.log("   FILTERS IN URL:", JSON.stringify(params));
  console.log("   keyword/role applied?  ", /full.?stack|role|keyword|q=|term=/i.test(feedUrl));
  console.log("   remote/location applied?", /remote|location|office/i.test(feedUrl));
  await snap(page, "proof-2-filtered-feed");

  console.log("\n[4] OPEN A JOB POST");
  const links = await harvestJobLinks(page, learned.recipe.jobLinkRegex, 10, 4);
  console.log("   job links found:", links.length, "| first:", links[0]);
  await page.goto(links[0], { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await snap(page, "proof-3-job-post");
  const d = await scrapeDetail(page, { title: learned.recipe.titleSelector, company: learned.recipe.companySelector, jd: learned.recipe.jdSelector, posted: learned.recipe.postedSelector });
  console.log("   title:", d.position.slice(0, 70), "| jd chars:", d.jd.length);

  console.log("\n[5] MATCH vs PROFILE");
  const { required, nice } = extractJobSkills(d.jd);
  const r = scoreJob(profile, { requiredSkills: required, niceSkills: nice, yearsRequired: 0, applicantCount: 0 });
  console.log("   profile:", profile.title, `(${profile.yearsExperience}y)`, "skills:", profile.skills.slice(0, 6).join(","));
  console.log("   JD required skills:", required.slice(0, 10).join(","));
  console.log(`   => matchPct ${r.matchPct}% | matched: ${r.matchedTerms.slice(0,8).join(",")} | missing: ${r.missingTerms.slice(0,6).join(",")}`);

  await closeBrowser();
  console.log("\n   screenshots:", shots.filter(Boolean).join("  "));
  process.exit(0);
})();
