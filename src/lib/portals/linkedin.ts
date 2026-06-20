import type { BrowserContext, Locator, Page } from "playwright";
import { prisma } from "@/lib/db";
import { extractJobSkills } from "@/lib/matching/jd";
import { getContext, getPage, isLaunched, screenshot } from "./browser";
import type { ApplicantInfo, ApplyOutcome, FetchHooks, JobRecord, PortalAdapter, SearchQuery } from "./adapter";

/**
 * Real LinkedIn adapter — search + scrape (no auto-apply).
 *
 * Hard-won lessons baked in:
 *  - LinkedIn's CSS classes are hashed and change every build, so we DON'T use
 *    them. Login is detected from the `li_at` auth cookie; job content is read
 *    via stable signals (document.title, the /company/ link, and on-page text
 *    like "About the job" / "… ago" / "… applicants").
 *  - Job ids come from `data-occludable-job-id` on the results list.
 */

const JOBS_BASE = "https://www.linkedin.com/jobs/search/";
const LOGIN_URL = "https://www.linkedin.com/login";
const MAX_JOBS = 25;

// ---- session (li_at cookie) ------------------------------------------------
async function sessionFromContext(ctx: BrowserContext): Promise<boolean> {
  const cookies = await ctx.cookies("https://www.linkedin.com");
  return cookies.some((c) => c.name === "li_at" && Boolean(c.value));
}

/** Status check for the UI poll — must NOT launch the browser. */
async function isLoggedIn(): Promise<boolean> {
  if (!isLaunched()) return false;
  return sessionFromContext(await getContext());
}

/** Open the headed login page so the user can sign in. */
async function openLogin(): Promise<void> {
  const page = await getPage("linkedin");
  await page.bringToFront().catch(() => {});
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
}

/**
 * Return a logged-in page. If the `li_at` cookie is already present, proceed
 * immediately. Otherwise show the login page and poll the cookie until the user
 * signs in (up to maxMs) — never fail just because the DOM looks unfamiliar.
 */
async function ensureLoggedInPage(maxMs = 180_000): Promise<Page> {
  const ctx = await getContext();
  const page = await getPage("linkedin");
  await page.bringToFront().catch(() => {});
  if (await sessionFromContext(ctx)) return page;

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    if (await sessionFromContext(ctx)) return page;
  }
  throw new Error("Timed out waiting for LinkedIn sign-in (3 min). Sign in to the open window, then run again.");
}

// ---- search / parse helpers ------------------------------------------------
function buildSearchUrl(query: SearchQuery): string {
  const params = new URLSearchParams();
  if (query.role) params.set("keywords", query.role);
  params.set("f_WT", "2"); // Remote
  params.set("f_AL", "true"); // Easy Apply only — jobs the agent can actually fill/apply
  params.set("f_TPR", tprFromSince(query.since)); // posted-within window
  params.set("sortBy", "DD"); // most recent first
  return `${JOBS_BASE}?${params.toString()}`;
}

/** LinkedIn's "posted within" param is r<seconds>. Derive it from the cutoff. */
function tprFromSince(sinceIso?: string): string {
  if (!sinceIso) return "r86400";
  const secs = Math.round((Date.now() - new Date(sinceIso).getTime()) / 1000);
  return `r${Math.max(3600, secs)}`;
}

function withinSince(d: Date, sinceIso?: string): boolean {
  if (!sinceIso) return true;
  return d.getTime() >= new Date(sinceIso).getTime() - 60_000;
}

function parseYears(jd: string): number {
  const m = jd.match(/(\d{1,2})\+?\s*years?/i);
  return m ? Number(m[1]) : 0;
}

function parseApplicants(text: string): number {
  const m = text.replace(/,/g, "").match(/(\d+)\s*applicant/i);
  return m ? Number(m[1]) : 0;
}

/** LinkedIn relative "posted X ago" / "Reposted X ago" -> absolute Date. */
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

function guessSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/(lead|principal|staff|head)/.test(t)) return "Lead";
  if (/(senior|sr\.?|sr\b)/.test(t)) return "Senior";
  if (/(junior|jr\.?|entry|intern|associate)/.test(t)) return "Junior";
  return "Mid";
}

/**
 * In-page extractor — runs in the job-view DOM. Class-free on purpose: relies
 * on document.title, the company link href, and on-page text. Returns raw
 * strings; parsing/normalization happens in Node.
 */
function scrapeJobDetail() {
  const pick = (re: RegExp, maxLen = 70): string => {
    for (const e of Array.from(document.querySelectorAll("span,div,li"))) {
      const t = (e as HTMLElement).innerText?.trim() ?? "";
      if (t && t.length < maxLen && re.test(t)) return t;
    }
    return "";
  };
  const company = (document.querySelector("a[href*='/company/']") as HTMLElement | null)?.innerText?.trim() || "";

  let jd = "";
  const heads = Array.from(document.querySelectorAll("h1,h2,h3,strong,span")).filter(
    (e) => /^about the job$/i.test(((e as HTMLElement).innerText || "").trim())
  );
  if (heads[0]) {
    let n: HTMLElement | null = heads[0] as HTMLElement;
    for (let i = 0; i < 7 && n; i++) {
      n = n.parentElement;
      if (n && (n.innerText || "").length > 300) { jd = n.innerText; break; }
    }
  }
  if (jd.length < 200) {
    let best = "";
    document.querySelectorAll("section,article,div").forEach((e) => {
      const t = (e as HTMLElement).innerText || "";
      if (t.length > best.length && t.length < 14000) best = t;
    });
    jd = best;
  }

  const easyApply = Array.from(document.querySelectorAll("button, a")).some((b) => {
    const el = b as HTMLElement;
    const txt = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""}`;
    return /easy\s*apply/i.test(txt);
  });

  return {
    position: document.title.split("|")[0].trim(),
    companyFromTitle: document.title.split("|")[1]?.trim() || "",
    company,
    jd: jd.slice(0, 12000),
    posted: pick(/(ago|reposted)/i),
    applicants: pick(/(over\s+)?\d[\d,]*\s+applicant/i),
    easyApply,
  };
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
    portal: "linkedin",
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
    // Search is filtered to Easy Apply (f_AL=true), so these are applyable.
    // Trust the filter and fall back to live detection.
    easyApply: true,
    postedAt: raw.postedAt,
  };
  const row = await prisma.job.upsert({
    where: { portal_externalId: { portal: "linkedin", externalId: raw.externalId } },
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
  hooks?.onStatus?.("Opening browser…");
  const page = await ensureLoggedInPage();
  hooks?.onStatus?.("Signed in. Opening Remote jobs from the last 24 hours…");
  const out: JobRecord[] = [];

  await page.goto(buildSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(3000);

  // Harvest job ids, scrolling the list to lazy-load more.
  const ids = new Set<string>();
  for (let s = 0; s < 6 && ids.size < MAX_JOBS; s++) {
    const found = await page.$$eval("[data-occludable-job-id],[data-job-id]", (els) =>
      els.map((e) => e.getAttribute("data-occludable-job-id") || e.getAttribute("data-job-id")).filter(Boolean) as string[]
    );
    found.forEach((id) => ids.add(id));
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1200);
  }

  hooks?.onStatus?.(`Found ${ids.size} remote jobs. Reading each description…`);
  let i = 0;
  for (const externalId of ids) {
    i += 1;
    try {
      await page.goto(`https://www.linkedin.com/jobs/view/${externalId}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page
        .waitForFunction(() => !!document.querySelector("a[href*='/company/']"), { timeout: 12_000 })
        .catch(() => {});
      // let the apply button (Easy Apply vs external) render before we read it
      await page
        .waitForFunction(
          () => Array.from(document.querySelectorAll("button,a")).some((b) => /apply/i.test((b as HTMLElement).innerText || "")),
          { timeout: 6_000 }
        )
        .catch(() => {});
      await page.waitForTimeout(1000);

      const raw = await page.evaluate(scrapeJobDetail);
      if (!raw.jd || raw.jd.length < 120) continue;
      hooks?.onStatus?.(`Reading ${i}/${ids.size}: ${raw.position || "job"}`);

      const postedAt = parsePosted(raw.posted);
      if (!withinSince(postedAt, query.since)) continue;

      const rec = await persist({
        externalId,
        url: `https://www.linkedin.com/jobs/view/${externalId}/`,
        company: raw.company || raw.companyFromTitle,
        position: raw.position,
        jd: raw.jd,
        applicantCount: parseApplicants(raw.applicants),
        easyApply: raw.easyApply,
        postedAt,
      });
      out.push(rec);
      await hooks?.onJob?.(rec);
    } catch (err) {
      console.error(`[linkedin] skip job ${externalId}:`, err);
    }
  }
  // Leave the page open so the user can see the run; the context persists.
  return out;
}

/** Read the best-effort label text for a form field (label[for], wrapping
 *  label, aria-label, placeholder, name) so we can map it to a known value. */
async function fieldLabel(el: Locator): Promise<string> {
  return el
    .evaluate((node) => {
      const inp = node as HTMLInputElement;
      let lab = "";
      const id = inp.getAttribute("id");
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l) lab = (l as HTMLElement).innerText || "";
      }
      if (!lab) {
        const p = inp.closest("label");
        if (p) lab = (p as HTMLElement).innerText || "";
      }
      return [lab, inp.getAttribute("aria-label") || "", inp.getAttribute("placeholder") || "", inp.getAttribute("name") || ""].join(" | ");
    })
    .catch(() => "");
}

/** Fill empty contact fields in the Easy-Apply modal from the profile. Never
 *  overwrites a value LinkedIn pre-filled; never touches screening questions. */
export async function fillKnownFields(page: Page, a: ApplicantInfo): Promise<void> {
  const dialog = page.locator("div[role=dialog]").first();
  const scope = (await dialog.count()) ? dialog : page.locator("body");
  const inputs = scope.locator("input, textarea");
  const n = Math.min(await inputs.count(), 40);
  const [first, ...rest] = (a.fullName || "").split(/\s+/).filter(Boolean);
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const type = ((await el.getAttribute("type")) || "text").toLowerCase();
    if (["file", "checkbox", "radio", "hidden", "submit", "button", "search"].includes(type)) continue;
    const cur = (await el.inputValue().catch(() => "")) || "";
    if (cur.trim()) continue; // don't overwrite
    const label = (await fieldLabel(el)).toLowerCase();
    let v = "";
    if (/e-?mail/.test(label)) v = a.email;
    else if (/phone|mobile|telephone|\btel\b/.test(label)) v = a.phone;
    else if (/first name/.test(label)) v = first || "";
    else if (/last name|surname|family name/.test(label)) v = rest.join(" ");
    else if (/full name|^name|\bname\b/.test(label)) v = a.fullName;
    else if (/years|experience/.test(label)) v = a.yearsExperience ? String(a.yearsExperience) : "";
    if (v) await el.fill(v).catch(() => {});
  }
}

/** True if the modal has any REQUIRED field/question still unanswered. When
 *  unsure we return true (treat as needs_human) — never submit a risky form. */
export async function hasUnansweredRequired(page: Page): Promise<boolean> {
  const dialog = page.locator("div[role=dialog]").first();
  const scope = (await dialog.count()) ? dialog : page.locator("body");
  return scope
    .evaluate((root) => {
      const fields = Array.from(root.querySelectorAll("input, textarea, select"));
      for (const f of fields) {
        const inp = f as HTMLInputElement;
        const req = inp.required || inp.getAttribute("aria-required") === "true";
        if (!req) continue;
        const type = (inp.getAttribute("type") || "").toLowerCase();
        if (["hidden", "button", "submit", "file"].includes(type)) continue;
        if (inp.tagName === "SELECT") {
          if (!inp.value || /select an option/i.test(inp.value)) return true;
          continue;
        }
        if (type === "radio" || type === "checkbox") continue; // handled below
        if (!String(inp.value || "").trim()) return true;
      }
      const radios = Array.from(root.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
      const groups: Record<string, { req: boolean; checked: boolean }> = {};
      for (const r of radios) {
        const name = r.name || "";
        if (!name) continue;
        groups[name] ??= { req: false, checked: false };
        if (r.required || r.getAttribute("aria-required") === "true") groups[name].req = true;
        if (r.checked) groups[name].checked = true;
      }
      return Object.values(groups).some((g) => g.req && !g.checked);
    })
    .catch(() => true);
}

/**
 * Human-in-the-loop apply for LinkedIn. LinkedIn deliberately blocks reliable
 * automated Easy-Apply (the apply button/modal is suppressed or varied in an
 * automated session) and ToS forbids auto-submitting, so we DON'T auto-submit.
 * Instead we open the job in the logged-in window — with the Easy-Apply detail
 * pane (currentJobId) so the apply button is present — bring it to the front,
 * screenshot it, and hand off: you click Apply and finish. Reliable + ToS-safe.
 * (`fillKnownFields` / `hasUnansweredRequired` are kept + tested for reuse.)
 */
async function applyJob(job: JobRecord): Promise<ApplyOutcome> {
  const ctx = await getContext();
  if (!(await sessionFromContext(ctx))) {
    return { state: "failed", error: "Not signed in to LinkedIn. Connect first.", screenshots: [] };
  }
  const page = await getPage("linkedin");
  const shots: string[] = [];

  try {
    const jobId = job.externalId ?? job.url?.match(/(?:view\/|currentJobId=)(\d+)/)?.[1] ?? "";
    // Search detail pane renders the apply button; standalone /view often won't.
    const url = jobId
      ? `https://www.linkedin.com/jobs/search/?currentJobId=${jobId}`
      : job.url ?? "https://www.linkedin.com/jobs";
    await page.bringToFront().catch(() => {});
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    const s = await screenshot(page, "linkedin-opened");
    if (s) shots.push(s);

    return {
      state: "needs_human",
      error: "Opened on LinkedIn in your browser — review and click Apply there to finish.",
      screenshots: shots,
    };
  } catch (err) {
    const s = await screenshot(page, "linkedin-error");
    if (s) shots.push(s);
    return { state: "failed", error: err instanceof Error ? err.message : "Couldn't open the job.", screenshots: shots };
  }
}

export const linkedinAdapter: PortalAdapter = {
  name: "linkedin",
  fetchJobs,
  applyJob,
  isLoggedIn,
  openLogin,
};
