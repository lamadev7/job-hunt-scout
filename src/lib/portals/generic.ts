import type { Page } from "playwright";
import { prisma } from "@/lib/db";
import { extractJobSkills } from "@/lib/matching/jd";
import { getPage, isLaunched, screenshot } from "./browser";
import { learnRecipe } from "./learn";
import { buildSearchUrl, type Recipe } from "./recipe";
import { replaySteps } from "./steps";
import { loadRecipe, markRecipeFailed } from "./recipe-store";
import { harvestJobLinks, scrapeDetail, type DetailSelectors } from "./scrape";
import type { ApplyOutcome, FetchHooks, JobRecord, PortalAdapter, SearchQuery } from "./adapter";

/**
 * Generic, self-learning browser adapter for ANY portal without a hand-tuned
 * adapter. No per-site code: the first run LEARNS a scraping recipe (LLM + live
 * DOM, validated on a real job — see learn.ts), persists it, and replays it on
 * later runs. A recipe that stops working self-heals (re-learn once). If learning
 * is unavailable or fails, a blind heuristic scan still runs so the portal always
 * opens a real browser and attempts a scan, exactly like LinkedIn/Indeed.
 */

const MAX_JOBS = 25;
const MIN_JD = 120;

/** Generic job-link heuristic for the blind fallback (no recipe). */
const JOB_LINK_RE = /(\/job[s]?\/|\/viewjob|\/vacanc|\/career|\/position|\/opening|[?&](jk|gh_jid|jobid|job_id)=)/i;
/** Non-job pages that the loose blind regex tends to catch — drop them. */
const BLIND_EXCLUDE_RE =
  /(\/(faq|privacy|terms|cookies?|login|sign[-_]?in|sign[-_]?up|register|about|contact|blog|news|help|support|life-at|culture|benefits|internship-programs|candidate-privacy|career-services|teams?)(\/|$|#|\?))|\/positions\/?($|#|\?)|\/careers?\/?($|#|\?)/i;
const NO_SELECTORS: DetailSelectors = { title: "", company: "", jd: "", posted: "" };

// Per-portal "connected" flag — opened once via Connect. Cleared implicitly when
// the browser closes (isLoggedIn also requires isLaunched).
const connected = new Set<string>();

async function portalUrl(name: string): Promise<string> {
  const row = await prisma.portal.findUnique({ where: { name }, select: { url: true } });
  const url = row?.url?.trim();
  if (!url) throw new Error(`No URL configured for portal "${name}". Edit the portal in My Details.`);
  return url;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function parseYears(jd: string): number {
  const m = jd.match(/(\d{1,2})\+?\s*years?/i);
  return m ? Number(m[1]) : 0;
}

function parsePosted(text: string): Date {
  const now = Date.now();
  const m = text.match(/(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i);
  if (!m) return new Date(now);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms =
    unit === "minute" ? 60_000 :
    unit === "hour" ? 3_600_000 :
    unit === "day" ? 86_400_000 :
    unit === "week" ? 604_800_000 :
    2_592_000_000;
  return new Date(now - n * ms);
}

function withinSince(d: Date, sinceIso?: string): boolean {
  if (!sinceIso) return true;
  return d.getTime() >= new Date(sinceIso).getTime() - 60_000;
}

function guessSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/(lead|principal|staff|head)/.test(t)) return "Lead";
  if (/(senior|sr\.?|sr\b)/.test(t)) return "Senior";
  if (/(junior|jr\.?|entry|intern|associate)/.test(t)) return "Junior";
  return "Mid";
}

function selectorsOf(r: Recipe): DetailSelectors {
  return { title: r.titleSelector, company: r.companySelector, jd: r.jdSelector, posted: r.postedSelector };
}

export function makeGenericAdapter(name: string): PortalAdapter {
  async function openLogin(): Promise<void> {
    const page = await getPage(name);
    await page.bringToFront().catch(() => {});
    await page.goto(await portalUrl(name), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    connected.add(name);
  }

  async function isLoggedIn(): Promise<boolean> {
    return isLaunched() && connected.has(name);
  }

  async function persist(raw: {
    externalId: string;
    url: string;
    company: string;
    position: string;
    jd: string;
    easyApply: boolean;
    postedAt: Date;
  }): Promise<JobRecord> {
    const { required, nice } = extractJobSkills(raw.jd);
    const data = {
      portal: name,
      externalId: raw.externalId,
      url: raw.url,
      company: raw.company || "Unknown",
      position: raw.position || "Unknown role",
      location: "Remote",
      remote: true,
      seniority: guessSeniority(raw.position),
      jd: raw.jd,
      requiredSkills: required,
      niceSkills: nice,
      yearsRequired: parseYears(raw.jd),
      applicantCount: 0,
      easyApply: raw.easyApply,
      postedAt: raw.postedAt,
    };
    const row = await prisma.job.upsert({
      where: { portal_externalId: { portal: name, externalId: raw.externalId } },
      create: data,
      update: data,
    });
    return {
      id: row.id,
      portal: row.portal,
      externalId: row.externalId,
      url: row.url,
      company: row.company,
      position: row.position,
      location: row.location,
      remote: row.remote,
      seniority: row.seniority,
      jd: row.jd,
      requiredSkills: required,
      niceSkills: nice,
      yearsRequired: row.yearsRequired,
      applicantCount: row.applicantCount,
      salaryMin: row.salaryMin,
      salaryMax: row.salaryMax,
      easyApply: row.easyApply,
      postedAt: row.postedAt.toISOString(),
    };
  }

  /** Open a results URL, then harvest + scrape from it. */
  async function scan(
    page: Page,
    searchUrl: string,
    linkRegex: string,
    selectors: DetailSelectors,
    origin: string,
    query: SearchQuery,
    hooks?: FetchHooks,
    exclude?: RegExp
  ): Promise<JobRecord[]> {
    await page.goto(searchUrl, { waitUntil: "commit", timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    return scanCurrent(page, linkRegex, selectors, origin, query, hooks, exclude);
  }

  /**
   * Harvest matching links from the page AS IT CURRENTLY IS (used after a step
   * script has already navigated+filtered to the feed), then scrape + persist each.
   */
  async function scanCurrent(
    page: Page,
    linkRegex: string,
    selectors: DetailSelectors,
    origin: string,
    query: SearchQuery,
    hooks?: FetchHooks,
    exclude?: RegExp
  ): Promise<JobRecord[]> {
    const urls = await harvestJobLinks(page, linkRegex, MAX_JOBS, 8, exclude);
    if (!urls.length) return [];

    hooks?.onStatus?.(`Found ${urls.length} listings on ${name}. Reading each…`);
    const out: JobRecord[] = [];
    let i = 0;
    for (const url of urls) {
      i += 1;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(900);
        const d = await scrapeDetail(page, selectors);
        if (!d.jd || d.jd.length < MIN_JD) continue;
        hooks?.onStatus?.(`Reading ${i}/${urls.length}: ${d.position || "job"}`);

        const postedAt = parsePosted(d.posted);
        if (!withinSince(postedAt, query.since)) continue;

        const externalId = url.replace(origin, "").slice(0, 180) || url.slice(0, 180);
        const rec = await persist({
          externalId,
          url,
          company: d.company,
          position: d.position,
          jd: d.jd,
          easyApply: d.easyApply,
          postedAt,
        });
        out.push(rec);
        await hooks?.onJob?.(rec);
      } catch (err) {
        console.error(`[${name}] skip ${url}:`, err);
      }
    }
    return out;
  }

  async function replay(page: Page, base: string, recipe: Recipe, query: SearchQuery, hooks?: FetchHooks) {
    const sel = selectorsOf(recipe);
    const origin = originOf(base);
    // Preferred path: replay the remembered step script (route discovery + the
    // profile-driven filters) deterministically, then scrape the feed it lands on.
    if (recipe.steps.length) {
      hooks?.onStatus?.(`Replaying ${recipe.steps.length} saved step(s) on ${name}…`);
      await page.goto(base, { waitUntil: "commit", timeout: 45_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await replaySteps(page, recipe.steps, base, query);
      return scanCurrent(page, recipe.jobLinkRegex, sel, origin, query, hooks);
    }
    // Legacy recipe: a single templated search URL.
    const searchUrl = buildSearchUrl(recipe.searchUrlTemplate, base, query);
    return scan(page, searchUrl, recipe.jobLinkRegex, sel, origin, query, hooks);
  }

  async function fetchJobs(query: SearchQuery, hooks?: FetchHooks): Promise<JobRecord[]> {
    const base = await portalUrl(name);
    const origin = originOf(base);
    const page = await getPage(name);
    await page.bringToFront().catch(() => {});
    hooks?.onStatus?.(`Opening ${name}…`);
    connected.add(name);

    // 1) Use a learned recipe if we have one; else learn now.
    let recipe = await loadRecipe(name);
    let freshlyLearned = false;
    if (!recipe) {
      const learned = await learnRecipe(name, base, page, query, hooks);
      recipe = learned?.recipe ?? null;
      freshlyLearned = Boolean(recipe);
    }

    // 2) Replay. If a STORED recipe yields nothing, it has drifted — self-heal
    //    (mark failed, re-learn once) before falling back.
    if (recipe) {
      let out = await replay(page, base, recipe, query, hooks);
      if (out.length) return out;

      if (!freshlyLearned) {
        hooks?.onStatus?.(`${name} recipe stale — relearning…`);
        await markRecipeFailed(name);
        const relearned = await learnRecipe(name, base, page, query, hooks);
        if (relearned?.recipe) {
          out = await replay(page, base, relearned.recipe, query, hooks);
          if (out.length) return out;
        }
      }
    }

    // 3) Guaranteed-safe blind heuristic scan (no recipe / learning unavailable).
    hooks?.onStatus?.(`Scanning ${name} (generic mode)…`);
    const out = await scan(page, base, JOB_LINK_RE.source, NO_SELECTORS, origin, query, hooks, BLIND_EXCLUDE_RE);
    if (out.length) return out;

    throw new Error(
      `No jobs found on ${name}. Sign in / solve any check in the opened window, or the site's layout isn't auto-readable yet.`
    );
  }

  /** Open the listing and hand off — never auto-submit an arbitrary site's form. */
  async function applyJob(job: JobRecord): Promise<ApplyOutcome> {
    const page = await getPage(name);
    const shots: string[] = [];
    try {
      const url = job.url ?? (await portalUrl(name));
      await page.bringToFront().catch(() => {});
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const s = await screenshot(page, `${name}-opened`);
      if (s) shots.push(s);
      return {
        state: "needs_human",
        error: `Opened on ${name} in your browser — review and click Apply there to finish.`,
        screenshots: shots,
      };
    } catch (err) {
      const s = await screenshot(page, `${name}-error`);
      if (s) shots.push(s);
      return { state: "failed", error: err instanceof Error ? err.message : "Couldn't open the job.", screenshots: shots };
    }
  }

  return { name, fetchJobs, applyJob, isLoggedIn, openLogin };
}
