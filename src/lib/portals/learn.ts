import type { Page } from "playwright";
import { askJson, aiExtractionAvailable } from "@/lib/llm/client";
import type { FetchHooks, SearchQuery } from "./adapter";
import { buildSearchUrl, coerceRecipeDraft, type Recipe } from "./recipe";
import { saveRecipe } from "./recipe-store";
import { harvestJobLinks, scrapeDetail } from "./scrape";

/**
 * Recipe LEARNER. For a portal with no hand-tuned adapter, we open the live site,
 * profile its results page, ask the LLM to infer a scraping recipe, then VALIDATE
 * that recipe on a real job before saving it. Validation is the safety net — we
 * never persist a recipe we couldn't actually use, so replay is trustworthy.
 */

const MAX_LINKS = 25;
const MIN_JD = 200; // a real JD is long; shorter == we grabbed nav/boilerplate

/** Compact, LLM-friendly snapshot of the results page (links + filter inputs). */
async function profileResultsPage(page: Page): Promise<{
  url: string;
  anchors: { href: string; text: string }[];
  inputs: { name: string; id: string; placeholder: string; type: string; label: string }[];
}> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const anchors: { href: string; text: string }[] = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = (a as HTMLAnchorElement).href;
      if (!href || seen.has(href)) continue;
      seen.add(href);
      anchors.push({ href, text: ((a as HTMLElement).innerText || "").trim().slice(0, 80) });
      if (anchors.length >= 60) break;
    }
    const inputs = Array.from(document.querySelectorAll("input, select")).slice(0, 25).map((el) => {
      const i = el as HTMLInputElement;
      return {
        name: i.getAttribute("name") || "",
        id: i.getAttribute("id") || "",
        placeholder: i.getAttribute("placeholder") || "",
        type: i.getAttribute("type") || el.tagName.toLowerCase(),
        label: i.getAttribute("aria-label") || "",
      };
    });
    return { url: location.href, anchors, inputs };
  });
}

function buildPrompt(
  portal: string,
  baseUrl: string,
  profile: Awaited<ReturnType<typeof profileResultsPage>>
): string {
  return [
    `You are configuring an automated scraper for the job board "${portal}" (${baseUrl}).`,
    `I navigated to its listing page and captured the links and search inputs below.`,
    `Infer a REUSABLE scraping recipe and return it as a single JSON object — no prose, no code fences.`,
    ``,
    `JSON shape (all keys required; use "" when unknown):`,
    `{`,
    `  "searchUrlTemplate": "absolute search URL with placeholders {role} {location} {sinceDays} {remote}, or \"\" to just use the base url",`,
    `  "jobLinkRegex": "JS regex (no slashes/flags) matched against a job DETAIL link's full URL, e.g. \\\\/jobs\\\\/view\\\\/ or \\\\/viewjob",`,
    `  "titleSelector": "CSS selector for the job title on a detail page, or \"\"",`,
    `  "companySelector": "CSS selector for the company name, or \"\"",`,
    `  "jdSelector": "CSS selector for the full job-description text, or \"\"",`,
    `  "postedSelector": "CSS selector for the posted-date text, or \"\"",`,
    `  "confidence": 0.0`,
    `}`,
    ``,
    `Rules:`,
    `- jobLinkRegex is the MOST important field: pick the URL substring common to job detail links (look at the hrefs), generic enough to match all of them but not nav/category links.`,
    `- For searchUrlTemplate, use the search input "name" attributes to map params (e.g. keyword box name -> {role}). If unsure, return "".`,
    `- Selectors: prefer stable ids/data-testid/semantic tags over hashed class names. If unsure, return "" (a heuristic fallback handles it).`,
    ``,
    `LINKS: ${JSON.stringify(profile.anchors)}`,
    `INPUTS: ${JSON.stringify(profile.inputs)}`,
  ].join("\n");
}

/**
 * Learn + validate a recipe for `portal`. Returns the saved recipe (+ the sample
 * job url it was validated on) or null if no LLM is available, the LLM produced
 * nothing usable, or validation failed. Caller falls back to blind heuristic.
 */
export async function learnRecipe(
  portal: string,
  baseUrl: string,
  page: Page,
  query: SearchQuery,
  hooks?: FetchHooks
): Promise<{ recipe: Recipe; sampleUrl: string } | null> {
  if (!(await aiExtractionAvailable())) return null;

  hooks?.onStatus?.(`Learning how to read ${portal}…`);
  await page.goto(baseUrl, { waitUntil: "commit", timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const profile = await profileResultsPage(page).catch(() => null);
  if (!profile || profile.anchors.length === 0) return null;

  // The LLM (esp. the CLI tier with no API key) can return nothing parseable on
  // a first try; one retry makes learning reliable without being expensive.
  const prompt = buildPrompt(portal, baseUrl, profile);
  let draft = coerceRecipeDraft(await askJson(prompt));
  if (!draft) draft = coerceRecipeDraft(await askJson(prompt));
  if (!draft) return null;

  // ---- validate on a live sample (try the templated URL, then the base) ----
  const candidates = [buildSearchUrl(draft.searchUrlTemplate, baseUrl, query)];
  if (draft.searchUrlTemplate.trim()) candidates.push(baseUrl);

  for (const searchUrl of candidates) {
    hooks?.onStatus?.(`Testing learned recipe for ${portal}…`);
    await page.goto(searchUrl, { waitUntil: "commit", timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const links = await harvestJobLinks(page, draft.jobLinkRegex, MAX_LINKS, 4);
    if (!links.length) continue;

    await page.goto(links[0], { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
    const detail = await scrapeDetail(page, {
      title: draft.titleSelector,
      company: draft.companySelector,
      jd: draft.jdSelector,
      posted: draft.postedSelector,
    });
    if (detail.jd.length < MIN_JD) continue;

    // Validated. If the template yielded nothing we'd have skipped it above, so
    // persist whichever URL actually worked (empty template => base url).
    if (searchUrl === baseUrl) draft.searchUrlTemplate = "";
    const recipe = await saveRecipe(draft, portal, links[0]);
    hooks?.onStatus?.(`Learned ${portal}. Scanning…`);
    return { recipe, sampleUrl: links[0] };
  }
  return null;
}
