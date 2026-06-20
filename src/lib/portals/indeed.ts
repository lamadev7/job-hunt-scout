import type { Page } from "playwright";
import { prisma } from "@/lib/db";
import { extractJobSkills } from "@/lib/matching/jd";
import { getPage, isLaunched, screenshot } from "./browser";
import type { ApplyOpts, ApplyOutcome, FetchHooks, JobRecord, PortalAdapter, SearchQuery } from "./adapter";

/**
 * Real Indeed adapter — opens a headed browser, searches Remote jobs from the
 * last day, and scrapes each description (no auto-apply).
 *
 * Stable signals only (Indeed's class names are hashed/volatile):
 *  - job keys come from the `data-jk` attribute on the results list,
 *  - the description is read from `#jobDescriptionText` (a stable id),
 *  - title/company use `data-testid` hooks with document.title as a fallback.
 *
 * Indeed sits behind Cloudflare. We run headed so the user can solve any
 * challenge / sign in once; we poll for results before giving up.
 */

const JOBS_BASE = "https://www.indeed.com/jobs";
const VIEW_BASE = "https://www.indeed.com/viewjob";
const MAX_JOBS = 25;

function buildSearchUrl(query: SearchQuery): string {
  const params = new URLSearchParams();
  params.set("q", query.role || "software engineer");
  params.set("l", "Remote");
  params.set("fromage", fromageFromSince(query.since)); // posted-within window
  params.set("sort", "date");
  return `${JOBS_BASE}?${params.toString()}`;
}

/** Indeed's "fromage" accepts a few discrete day values; snap the cutoff to one. */
function fromageFromSince(sinceIso?: string): string {
  if (!sinceIso) return "1";
  const days = Math.ceil((Date.now() - new Date(sinceIso).getTime()) / 86_400_000);
  if (days <= 1) return "1";
  if (days <= 3) return "3";
  if (days <= 7) return "7";
  return "14"; // Indeed's max bucket
}

function parseYears(jd: string): number {
  const m = jd.match(/(\d{1,2})\+?\s*years?/i);
  return m ? Number(m[1]) : 0;
}

function parseApplicants(text: string): number {
  const m = text.replace(/,/g, "").match(/(\d+)\s*(?:applicant|people)/i);
  return m ? Number(m[1]) : 0;
}

/** Indeed "Posted X days ago" / "Active X days ago" -> absolute Date. */
function parsePosted(text: string): Date {
  const now = Date.now();
  const m = text.match(/(\d+)\s*(hour|day|week|month)s?\s*ago/i);
  if (!m) return new Date(now);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms =
    unit === "hour" ? 3_600_000 :
    unit === "day" ? 86_400_000 :
    unit === "week" ? 604_800_000 :
    2_592_000_000;
  return new Date(now - n * ms);
}

function guessSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/(lead|principal|staff|head)/.test(t)) return "Lead";
  if (/(senior|sr\.?|sr\b)/.test(t)) return "Senior";
  if (/(junior|jr\.?|entry|intern|associate)/.test(t)) return "Junior";
  return "Mid";
}

/** Indeed treats login as optional for browsing; report status without launching. */
async function isLoggedIn(): Promise<boolean> {
  return isLaunched();
}

async function openLogin(): Promise<void> {
  const page = await getPage("indeed");
  await page.bringToFront().catch(() => {});
  await page.goto("https://secure.indeed.com/auth", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
}

/**
 * Open the results page and wait until job cards appear — giving the user time
 * to clear a Cloudflare/login challenge in the headed window.
 */
async function openResults(query: SearchQuery, hooks?: FetchHooks): Promise<Page> {
  const page = await getPage("indeed");
  await page.bringToFront().catch(() => {});
  hooks?.onStatus?.("Opening Indeed…");
  // "commit" + catch: Cloudflare interstitials / redirects can ABORT a
  // domcontentloaded wait; we don't care — we poll for job cards next.
  await page.goto(buildSearchUrl(query), { waitUntil: "commit", timeout: 45_000 }).catch(() => {});

  const deadline = Date.now() + 120_000;
  let warned = false;
  while (Date.now() < deadline) {
    const card = await page.$("a[data-jk], [data-jk]").catch(() => null);
    if (card) return page;
    if (!warned) {
      hooks?.onStatus?.("Waiting for Indeed to load (solve any verification in the window)…");
      warned = true;
    }
    await page.waitForTimeout(2500);
  }
  throw new Error(
    "Indeed didn't return job results (likely a Cloudflare check). Solve the challenge in the opened window, then run again."
  );
}

/** In-page extractor for a /viewjob page. Class-free; relies on stable ids/testids. */
function scrapeJobDetail() {
  const q = (s: string) => document.querySelector(s) as HTMLElement | null;
  const title =
    q("h1.jobsearch-JobInfoHeader-title")?.innerText?.trim() ||
    q('[data-testid="jobsearch-JobInfoHeader-title"]')?.innerText?.trim() ||
    document.title.split(" - ")[0].trim();
  const company =
    q('[data-testid="inlineHeader-companyName"]')?.innerText?.trim() ||
    q('[data-testid="company-name"]')?.innerText?.trim() ||
    q('div[data-company-name="true"] a')?.innerText?.trim() ||
    "";
  const jd = q("#jobDescriptionText")?.innerText?.trim() || "";
  const bodyText = (document.body.innerText || "").slice(0, 3000);
  const easyApply = Array.from(document.querySelectorAll("button,a")).some((b) =>
    /apply now|easily apply/i.test((b as HTMLElement).innerText || "")
  );
  return { title, company, jd: jd.slice(0, 12000), bodyText, easyApply };
}

async function persist(raw: {
  externalId: string;
  url: string;
  company: string;
  position: string;
  jd: string;
  applicantCount: number;
  easyApply: boolean;
  postedAt: Date;
}): Promise<JobRecord> {
  const { required, nice } = extractJobSkills(raw.jd);
  const data = {
    portal: "indeed",
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
    applicantCount: raw.applicantCount,
    easyApply: raw.easyApply,
    postedAt: raw.postedAt,
  };
  const row = await prisma.job.upsert({
    where: { portal_externalId: { portal: "indeed", externalId: raw.externalId } },
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

async function fetchJobs(query: SearchQuery, hooks?: FetchHooks): Promise<JobRecord[]> {
  const page = await openResults(query, hooks);
  hooks?.onStatus?.("Indeed loaded. Reading Remote jobs from the last 24 hours…");
  const out: JobRecord[] = [];

  // Harvest job keys, scrolling to lazy-load more.
  const ids = new Set<string>();
  for (let s = 0; s < 6 && ids.size < MAX_JOBS; s++) {
    const found = await page.$$eval("a[data-jk],[data-jk]", (els) =>
      els.map((e) => e.getAttribute("data-jk")).filter(Boolean) as string[]
    );
    found.forEach((id) => ids.add(id));
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1200);
  }

  hooks?.onStatus?.(`Found ${ids.size} Indeed jobs. Reading each description…`);
  let i = 0;
  for (const externalId of ids) {
    i += 1;
    if (i > MAX_JOBS) break;
    try {
      await page.goto(`${VIEW_BASE}?jk=${externalId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page
        .waitForFunction(() => !!document.querySelector("#jobDescriptionText"), { timeout: 12_000 })
        .catch(() => {});
      await page.waitForTimeout(800);

      const raw = await page.evaluate(scrapeJobDetail);
      if (!raw.jd || raw.jd.length < 120) continue;
      hooks?.onStatus?.(`Reading ${i}/${ids.size}: ${raw.title || "job"}`);

      const rec = await persist({
        externalId,
        url: `${VIEW_BASE}?jk=${externalId}`,
        company: raw.company,
        position: raw.title,
        jd: raw.jd,
        applicantCount: parseApplicants(raw.bodyText),
        easyApply: raw.easyApply,
        postedAt: parsePosted(raw.bodyText),
      });
      out.push(rec);
      await hooks?.onJob?.(rec);
    } catch (err) {
      console.error(`[indeed] skip job ${externalId}:`, err);
    }
  }
  return out;
}

/**
 * Indeed Apply is multi-step + screening-question heavy and varies per employer,
 * so we never auto-submit it. We open the on-site apply flow (so the resume +
 * fields are pre-filled by Indeed where possible) and hand off to the user.
 * Dry-run just confirms an on-site Apply button exists.
 */
async function applyJob(job: JobRecord, { dryRun }: ApplyOpts): Promise<ApplyOutcome> {
  const page = await getPage("indeed");
  const shots: string[] = [];
  const push = async (label: string) => {
    const s = await screenshot(page, `indeed-${label}`);
    if (s) shots.push(s);
  };

  try {
    const url = job.url ?? `${VIEW_BASE}?jk=${job.externalId}`;
    await page.bringToFront().catch(() => {});
    await page.goto(url, { waitUntil: "commit", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const applyBtn = page
      .locator("#indeedApplyButton, .indeed-apply-button, button:has-text('Apply now'), a:has-text('Apply now')")
      .first();
    if (!(await applyBtn.count())) {
      await push("no-apply");
      return { state: "skipped_external", error: "No on-site Apply — apply on the employer site.", screenshots: shots };
    }
    if (dryRun) {
      await push("dry-run-ready");
      return { state: "dry_run", screenshots: shots };
    }
    await applyBtn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await push("apply-opened");
    return {
      state: "needs_human",
      error: "Indeed Apply opened — review the pre-filled form and submit in the window.",
      screenshots: shots,
    };
  } catch (err) {
    await push("error");
    return { state: "failed", error: err instanceof Error ? err.message : "Apply failed.", screenshots: shots };
  }
}

export const indeedAdapter: PortalAdapter = {
  name: "indeed",
  fetchJobs,
  applyJob,
  isLoggedIn,
  openLogin,
};
