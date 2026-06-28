import type { Page } from "playwright";

/**
 * Browser scraping primitives shared by the recipe LEARNER (learn.ts, validation
 * pass) and the recipe REPLAY (generic.ts). Kept here so both use the exact same
 * extraction — what we validate is literally what we later replay.
 */

export type Detail = {
  position: string;
  company: string;
  jd: string;
  posted: string;
  easyApply: boolean;
};

export type DetailSelectors = {
  title: string;
  company: string;
  jd: string;
  posted: string;
};

/** Canonical key for dedupe: drop the #fragment and any trailing slash, lowercase.
 *  So "/positions/", "/positions", and "/positions/#main" collapse to one. */
function canonicalKey(href: string): string {
  return href.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
}

/** Same as canonicalKey but ALSO drops the query string — so a job link is judged
 *  distinct from the results page only by PATH, and "?a=1" vs "?a=2" of the same
 *  results page both collapse to the feed itself. */
function pathKey(href: string): string {
  try {
    const u = new URL(href);
    return (u.origin + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return canonicalKey(href);
  }
}

// A page that is a LOGIN/marketing gate, not a real job. We must never persist a
// recipe (or a job) validated against one of these — that was the job-leads bug.
const GATE_RE =
  /(just a moment|checking your browser|verify(ing)? you are human|enable javascript|please (sign|log) ?in|create (a |an )?(free )?account|enhance your job search|unlock (your|more)|sign up to|register to (see|view|apply)|access denied|are you a robot)/i;

// Signals that the body actually describes a job. A real JD has several of these.
const JOB_SIGNALS = [
  /responsibilit/i,
  /requirement/i,
  /qualificat/i,
  /years? of experience/i,
  /what you'?ll (do|be doing)/i,
  /about (the|this) (role|team|position|job)/i,
  /we(?:'re| are) looking for/i,
  /(benefits|compensation|salary|perks)/i,
  /(skills|proficien|expertise) (in|with)/i,
  /(apply|application) (now|for this)/i,
];

/**
 * Is the scraped page a REAL job detail page (not a login wall, marketing CTA, or
 * bot interstitial)? Requires a substantial body, no gate phrasing in the title,
 * and at least two distinct job-content signals. This is the gate that stops a
 * logged-out board (job-leads, arc.dev) from "learning" a bogus recipe off its
 * sign-in page.
 */
// A search-results / category AGGREGATION page (not a single posting). Titles
// like "99 Business Development jobs in Kathmandu", "Software Engineer Jobs",
// "Jobs in London" — these list many jobs and must never be scored as one job.
const AGG_TITLE_RE = /(\bjobs?\b\s+in\s+\w|^\s*\d[\d,]*\s+.+\bjobs?\b|\bjobs?\b\s*$|search results|^jobs\b)/i;

export function looksLikeJob(d: Detail, minJd = 300): boolean {
  if (!d.jd || d.jd.length < minJd) return false;
  if (GATE_RE.test(d.position) || GATE_RE.test(d.jd.slice(0, 400))) return false;
  // Reject aggregation/listing pages by their tell-tale title shape.
  if (AGG_TITLE_RE.test(d.position.trim())) return false;
  const hay = `${d.position}\n${d.jd}`;
  const hits = JOB_SIGNALS.reduce((n, re) => n + (re.test(hay) ? 1 : 0), 0);
  return hits >= 2;
}

/**
 * Does the CURRENT page look like a sign-in / bot / marketing gate rather than
 * browsable content? Used to give a precise "log in, then retry" message for
 * login-walled boards (arc.dev, job-leads) instead of a vague "no jobs found".
 * Signals: a gate phrase in title/heading, a password field, or a sign-in/sign-up
 * form with very little other content.
 */
export async function pageLooksLikeGate(page: Page): Promise<boolean> {
  return page
    .evaluate((src) => {
      const re = new RegExp(src, "i");
      const title = document.title || "";
      const h1 = (document.querySelector("h1, h2")?.textContent || "").trim();
      const hasPassword = !!document.querySelector("input[type='password']");
      const body = (document.body?.innerText || "").trim();
      const authButton = Array.from(document.querySelectorAll("button, a, input[type='submit']")).some((b) =>
        /\b(sign in|log in|login|sign up|create account|continue with)\b/i.test(
          (b as HTMLElement).innerText || (b as HTMLInputElement).value || ""
        )
      );
      if (re.test(title) || re.test(h1)) return true;
      if (hasPassword) return true;
      // An auth control with little real content => a gate, not a results page.
      if (authButton && body.length < 1500) return true;
      return false;
    }, GATE_RE.source)
    .catch(() => false);
}

/**
 * Scroll the results page, collecting absolute hrefs that match `regexSource`.
 * Stops at `max` links or `rounds` scrolls. Dedupes by canonical key (so the same
 * page linked under different #fragments isn't scraped repeatedly), preserves
 * first-seen order, and skips any href matching `exclude` (used by the blind
 * fallback to drop nav/footer pages like FAQ / privacy / login).
 */
export async function harvestJobLinks(
  page: Page,
  regexSource: string,
  max: number,
  rounds: number,
  exclude?: RegExp
): Promise<string[]> {
  let re: RegExp;
  try {
    re = new RegExp(regexSource, "i");
  } catch {
    return [];
  }
  // A job-DETAIL link must differ (by path) from the results page we're harvesting
  // from — otherwise a self-referential listing link (e.g. "/us/jobs/l/Remote" on
  // the page of the same url) gets mistaken for a job. This was the job-leads bug.
  const selfPath = pathKey(page.url());
  const seen = new Set<string>();
  const out: string[] = [];
  for (let s = 0; s < rounds && out.length < max; s++) {
    const hrefs = await page
      .$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href))
      .catch(() => [] as string[]);
    for (const h of hrefs) {
      if (!h || !re.test(h)) continue;
      if (exclude && exclude.test(h)) continue;
      if (pathKey(h) === selfPath) continue; // skip the results page itself
      const key = canonicalKey(h);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
      if (out.length >= max) break;
    }
    await page.mouse.wheel(0, 2400).catch(() => {});
    await page.waitForTimeout(1200);
  }
  return out.slice(0, max);
}

/**
 * Extract a job's fields from the CURRENT detail page. Each learned selector is
 * tried first; if it's empty/invalid we fall back to a robust heuristic (page
 * title, company link, largest text block) so a partially-wrong recipe still
 * yields usable data instead of nothing.
 */
export async function scrapeDetail(page: Page, sel: DetailSelectors): Promise<Detail> {
  return page.evaluate((sel) => {
    const txt = (el: Element | null): string => ((el as HTMLElement | null)?.innerText || "").trim();
    const bySel = (s: string): Element | null => {
      if (!s) return null;
      try {
        return document.querySelector(s);
      } catch {
        return null;
      }
    };

    let best = "";
    document.querySelectorAll("main,article,section,div").forEach((e) => {
      const t = (e as HTMLElement).innerText || "";
      if (t.length > best.length && t.length < 16000) best = t;
    });

    const title = txt(bySel(sel.title)) || (document.title.split(/[|\-–—]/)[0] || "").trim();
    const company =
      txt(bySel(sel.company)) ||
      txt(document.querySelector("a[href*='/company/'], [data-testid*='company'], [class*='company']"));
    const jd = txt(bySel(sel.jd)) || best;
    const posted = txt(bySel(sel.posted)) || (document.body.innerText || "").slice(0, 4000);
    const easyApply = Array.from(document.querySelectorAll("button,a")).some((b) =>
      /apply now|easy apply|easily apply|quick apply/i.test((b as HTMLElement).innerText || "")
    );
    return { position: title, company, jd: (jd || "").slice(0, 12000), posted, easyApply };
  }, sel);
}
