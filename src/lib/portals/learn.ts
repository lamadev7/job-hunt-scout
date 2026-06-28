import type { Page } from "playwright";
import { askJson, aiExtractionAvailable } from "@/lib/llm/client";
import type { FetchHooks, SearchQuery } from "./adapter";
import { coerceRecipeDraftWithSteps, sinceDays, substitute, type Recipe, type RecipeDraft } from "./recipe";
import { saveRecipe } from "./recipe-store";
import { replaySteps } from "./steps";
import { harvestJobLinks, looksLikeJob, scrapeDetail } from "./scrape";

/**
 * Recipe LEARNER. For a portal with no hand-tuned adapter, the agent opens the
 * live site and works out, on its own, HOW to reach a filtered job feed and read
 * it — then saves that as a replayable step script (see steps.ts) so later runs
 * never re-learn.
 *
 * The hard part real portals pose: the URL the user adds is often a HOMEPAGE or
 * marketing/careers landing, NOT the job-results list. So the learner is agentic
 * and iterative:
 *   round 1  profile the landing → ask the LLM for a navigation+filter STEP SCRIPT
 *            (click "Find Jobs", fill the search with the candidate's role, choose
 *            Remote / a recency filter) plus a job-link regex + detail selectors.
 *   execute  run the steps in the browser to land on the (now filtered) feed.
 *   validate harvest job links + confirm the first one yields a real JD.
 *   round 2+ if validation fails, RE-profile wherever we ended up (often the feed
 *            itself, where the real job-detail links are finally visible) and ask
 *            the LLM to correct the steps/regex. Converges in a couple of rounds.
 * We never persist a recipe we couldn't actually use end-to-end, so replay stays
 * trustworthy.
 */

const MAX_LINKS = 25;
const MIN_JD = 200; // a real JD is long; shorter == we grabbed nav/boilerplate
const MAX_ROUNDS = 3;

const DEBUG = Boolean(process.env.LEARN_DEBUG);
const dbg = (...a: unknown[]) => DEBUG && console.error("[learn]", ...a);

type PageProfile = {
  url: string;
  anchors: { href: string; text: string }[];
  inputs: { name: string; id: string; placeholder: string; type: string; label: string }[];
  clickables: { text: string; tag: string; id: string; aria: string }[];
};

/** Compact, LLM-friendly snapshot: links, filter inputs, and clickable controls. */
async function profilePage(page: Page): Promise<PageProfile> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const anchors: { href: string; text: string }[] = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = (a as HTMLAnchorElement).href;
      if (!href || seen.has(href)) continue;
      seen.add(href);
      anchors.push({ href, text: ((a as HTMLElement).innerText || "").trim().slice(0, 60) });
      if (anchors.length >= 80) break;
    }
    const inputs = Array.from(document.querySelectorAll("input, select")).slice(0, 30).map((el) => {
      const i = el as HTMLInputElement;
      return {
        name: i.getAttribute("name") || "",
        id: i.getAttribute("id") || "",
        placeholder: i.getAttribute("placeholder") || "",
        type: i.getAttribute("type") || el.tagName.toLowerCase(),
        label: i.getAttribute("aria-label") || "",
      };
    });
    // Clickable controls (nav links, filter chips, "Find Jobs" buttons) — the
    // things the agent may need to click to reach/filter the feed.
    const clickables: { text: string; tag: string; id: string; aria: string }[] = [];
    const cseen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll("button, a, [role='button'], [role='tab']"))) {
      const text = ((el as HTMLElement).innerText || "").trim().slice(0, 40);
      const aria = el.getAttribute("aria-label") || "";
      const key = (text || aria).toLowerCase();
      if (!key || cseen.has(key)) continue;
      // Keep controls that read like navigation/filters — drop generic noise.
      if (!/job|career|position|opening|browse|find|search|remote|filter|date|recent|posted|category|role|apply|view/i.test(key)) continue;
      cseen.add(key);
      clickables.push({ text, tag: el.tagName.toLowerCase(), id: el.getAttribute("id") || "", aria });
      if (clickables.length >= 30) break;
    }
    return { url: location.href, anchors, inputs, clickables };
  });
}

/** Did harvesting the current page with `regex` find real job-detail links? */
async function probeLinks(page: Page, regex: string): Promise<string[]> {
  return harvestJobLinks(page, regex, MAX_LINKS, 4);
}

function buildPrompt(
  portal: string,
  baseUrl: string,
  query: SearchQuery,
  snap: PageProfile,
  round: number,
  feedback: string
): string {
  const filters = {
    role: query.role || "(any software role)",
    remote: query.remoteOnly ? "remote only" : "any location",
    location: query.location || (query.remoteOnly ? "Remote" : ""),
    postedWithinDays: sinceDays(query.since),
  };
  return [
    `You are configuring an automated job scraper for the board "${portal}" (${baseUrl}).`,
    `GOAL: produce a reusable STEP SCRIPT that, run in a browser starting from the base url`,
    `(already loaded), navigates to the JOB-RESULTS FEED and applies the candidate's filters,`,
    `plus a regex to pick job-detail links and CSS selectors to read a job page.`,
    ``,
    `The candidate's desired filters (apply whatever the site supports):`,
    JSON.stringify(filters),
    `Use the placeholders {role} {location} {sinceDays} {remote} inside step urls/values so the`,
    `same script re-applies the right filters on future searches.`,
    ``,
    `Return ONE JSON object — no prose, no code fences:`,
    `{`,
    `  "steps": [ ...ordered actions... ],`,
    `  "jobLinkRegex": "JS regex (no slashes/flags) matched against a job DETAIL link's full URL — match the PATH only, never the domain, e.g. \\\\/remote-jobs\\\\/[^/]+ or \\\\/jobs\\\\/\\\\d+",`,
    `  "titleSelector": "CSS selector for the job title on a detail page, or \"\"",`,
    `  "companySelector": "CSS selector for the company, or \"\"",`,
    `  "jdSelector": "CSS selector for the full job-description text, or \"\"",`,
    `  "postedSelector": "CSS selector for the posted-date, or \"\"",`,
    `  "confidence": 0.0`,
    `}`,
    ``,
    `Each step is ONE of:`,
    `  {"action":"goto","url":"absolute or site-relative url; may contain placeholders"}`,
    `  {"action":"fill","selector":"<css>","value":"{role}"}        // type into a search/filter box`,
    `  {"action":"click","selector":"<css or text=Label>"}          // nav link / filter chip / submit`,
    `  {"action":"select","selector":"<css>","value":"..."}         // choose a <select> option`,
    `  {"action":"press","selector":"<css or empty>","key":"Enter"} // submit a search box`,
    `  {"action":"waitFor","selector":"<css>"}                      // optional: wait for results`,
    ``,
    `Rules:`,
    `- If the current page is NOT a job-results list, the FIRST steps must get there: either a`,
    `  goto a known results path (often "/jobs", "/remote-jobs", "/remote-jobs/search?term={role}")`,
    `  or click a "Find Jobs"/"Remote jobs"/"Browse" link from the snapshot.`,
    `- Prefer a single goto with query params when the site filters via URL (cheapest + most stable).`,
    `  Map the search box's input "name" to {role}, location to {location}, recency to {sinceDays}.`,
    `- For click/fill selectors prefer a stable id, name, data-testid, aria-label, or a Playwright`,
    `  "text=Visible Label" selector. Avoid hashed class names.`,
    `- jobLinkRegex is the MOST important field: the PATH substring common to job-detail links on the`,
    `  RESULTS page, generic enough to match all of them but not nav/category links.`,
    ``,
    round > 0 ? `PREVIOUS ATTEMPT FEEDBACK (fix this): ${feedback}` : ``,
    ``,
    `CURRENT PAGE URL: ${snap.url}`,
    `LINKS: ${JSON.stringify(snap.anchors)}`,
    `SEARCH/FILTER INPUTS: ${JSON.stringify(snap.inputs)}`,
    `CLICKABLE CONTROLS: ${JSON.stringify(snap.clickables)}`,
  ].join("\n");
}

/** Ask the LLM for a recipe draft, retrying a few times (cold CLI can return nothing). */
async function askForDraft(prompt: string): Promise<RecipeDraft | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const draft = coerceRecipeDraftWithSteps(await askJson(prompt));
    if (draft) return draft;
  }
  return null;
}

/**
 * Learn + validate a recipe for `portal`. Returns the saved recipe (+ the sample
 * job url it validated on) or null if no LLM is available, the LLM produced
 * nothing usable, or we could not reach a feed with real jobs in MAX_ROUNDS.
 */
export async function learnRecipe(
  portal: string,
  baseUrl: string,
  page: Page,
  query: SearchQuery,
  hooks?: FetchHooks
): Promise<{ recipe: Recipe; sampleUrl: string } | null> {
  if (!(await aiExtractionAvailable())) return null;

  let feedback = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    hooks?.onStatus?.(
      round === 0 ? `Learning how to read ${portal}…` : `Refining ${portal} recipe (try ${round + 1})…`
    );

    // Always start each attempt from the base url so the step script is anchored.
    await page.goto(baseUrl, { waitUntil: "commit", timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const snap = await profilePage(page).catch(() => null);
    if (!snap || (snap.anchors.length === 0 && snap.clickables.length === 0)) {
      feedback = "The base page exposed no links or controls (it may require sign-in).";
      dbg(`round ${round}: empty page at ${page.url()}`);
      continue;
    }
    dbg(`round ${round}: at ${snap.url} — ${snap.anchors.length} links, ${snap.inputs.length} inputs, ${snap.clickables.length} clickables`);

    const draft = await askForDraft(buildPrompt(portal, baseUrl, query, snap, round, feedback));
    if (!draft) {
      feedback = "Your previous reply was missing/invalid JSON. Return exactly the JSON object.";
      dbg(`round ${round}: no valid draft from LLM`);
      continue;
    }
    dbg(`round ${round}: draft steps=`, JSON.stringify(draft.steps), `regex=/${draft.jobLinkRegex}/`);

    // ---- execute the step script (lands us on the filtered feed) ----
    hooks?.onStatus?.(`Following ${draft.steps.length || 1} step(s) to the ${portal} feed…`);
    if (draft.steps.length) {
      await replaySteps(page, draft.steps, baseUrl, query);
    } else if (draft.searchUrlTemplate.trim()) {
      // Legacy single-URL recipe — treat the template as one implicit goto.
      await page.goto(substitute(draft.searchUrlTemplate, query, true), { waitUntil: "commit", timeout: 45_000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // ---- validate: real job links on the page we ended up on ----
    const links = await probeLinks(page, draft.jobLinkRegex);
    dbg(`round ${round}: after steps at ${page.url()} — regex matched ${links.length} link(s)`, links.slice(0, 3));
    if (!links.length) {
      const after = await profilePage(page).catch(() => null);
      feedback =
        `After your steps the browser is at "${page.url()}" but jobLinkRegex /${draft.jobLinkRegex}/ matched 0 of the ` +
        `${after?.anchors.length ?? 0} links there. ` +
        (after ? `The links now visible are: ${JSON.stringify(after.anchors.slice(0, 40))}. ` : "") +
        `Either the steps didn't reach the job-results list, or the regex is wrong — fix whichever it is.`;
      continue;
    }

    // Confirm the first link is a real, readable job (not a category/nav page).
    await page.goto(links[0], { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(900);
    const detail = await scrapeDetail(page, {
      title: draft.titleSelector,
      company: draft.companySelector,
      jd: draft.jdSelector,
      posted: draft.postedSelector,
    });
    dbg(`round ${round}: sample ${links[0]} → jd ${detail.jd.length}ch, title="${detail.position.slice(0, 50)}", job=${looksLikeJob(detail, MIN_JD)}`);
    if (!looksLikeJob(detail, MIN_JD)) {
      feedback =
        `jobLinkRegex matched ${links[0]} but it is NOT a real job posting — it looks like a ` +
        `sign-in/marketing gate or a listing page (title "${detail.position.slice(0, 60)}", ` +
        `${detail.jd.length} chars, lacks job-description content). If the site needs sign-in the ` +
        `jobs aren't visible; otherwise point jobLinkRegex at individual job-DETAIL links only.`;
      continue;
    }

    // Validated end-to-end. Persist the step script + selectors for replay.
    const recipe = await saveRecipe(draft, portal, links[0]);
    hooks?.onStatus?.(`Learned ${portal} (${draft.steps.length} step(s)). Scanning…`);
    return { recipe, sampleUrl: links[0] };
  }

  return null;
}
