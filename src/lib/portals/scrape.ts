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
  const seen = new Set<string>();
  const out: string[] = [];
  for (let s = 0; s < rounds && out.length < max; s++) {
    const hrefs = await page
      .$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href))
      .catch(() => [] as string[]);
    for (const h of hrefs) {
      if (!h || !re.test(h)) continue;
      if (exclude && exclude.test(h)) continue;
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
