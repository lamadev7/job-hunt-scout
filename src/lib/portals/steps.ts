import type { Page } from "playwright";
import type { SearchQuery } from "./adapter";
import { substitute, type Step } from "./recipe";

/**
 * Deterministic step REPLAYER. Runs a recipe's saved navigation+filter script in
 * a real browser to land on the filtered results feed — NO LLM. This is the
 * "remember the steps and apply them" half: learn.ts discovers the script once,
 * generic.ts replays it here on every later run.
 *
 * Every step is best-effort and individually guarded: a single missing selector
 * (sites shuffle their DOM) must not abort the whole replay — we log and press on,
 * then the caller decides success by whether real job links were harvested. This
 * keeps replay resilient while the harvest+validate gate stays the source of truth.
 */

const STEP_TIMEOUT = 15_000;

/** Resolve a possibly-relative step url against the portal base, then substitute. */
function resolveUrl(raw: string, base: string, query: SearchQuery): string {
  const filled = substitute(raw, query, true);
  try {
    return new URL(filled, base).href;
  } catch {
    return filled;
  }
}

async function runStep(page: Page, step: Step, base: string, query: SearchQuery): Promise<void> {
  switch (step.action) {
    case "goto": {
      const url = resolveUrl(step.url, base, query);
      await page.goto(url, { waitUntil: "commit", timeout: STEP_TIMEOUT + 30_000 });
      await page.waitForTimeout(1500);
      return;
    }
    case "fill": {
      const value = substitute(step.value, query, false);
      const el = page.locator(step.selector).first();
      await el.fill(value, { timeout: STEP_TIMEOUT });
      return;
    }
    case "click": {
      await page.locator(step.selector).first().click({ timeout: STEP_TIMEOUT });
      await page.waitForTimeout(1200);
      return;
    }
    case "select": {
      const value = substitute(step.value, query, false);
      // Try by value, then by visible label — sites differ in which one is stable.
      const el = page.locator(step.selector).first();
      await el.selectOption(value, { timeout: STEP_TIMEOUT }).catch(async () => {
        await el.selectOption({ label: value }, { timeout: STEP_TIMEOUT });
      });
      await page.waitForTimeout(800);
      return;
    }
    case "press": {
      if (step.selector) await page.locator(step.selector).first().press(step.key, { timeout: STEP_TIMEOUT });
      else await page.keyboard.press(step.key);
      await page.waitForTimeout(1200);
      return;
    }
    case "waitFor": {
      if (step.selector) await page.waitForSelector(step.selector, { timeout: step.ms ?? STEP_TIMEOUT });
      else await page.waitForTimeout(step.ms ?? 1500);
      return;
    }
  }
}

/**
 * Run every step in order, landing the page on the filtered feed. Returns the
 * count of steps that executed without error (callers can treat a low ratio as a
 * signal the recipe has drifted). Never throws — failures are swallowed per step.
 */
export async function replaySteps(
  page: Page,
  steps: Step[],
  base: string,
  query: SearchQuery,
  onError?: (step: Step, err: unknown) => void
): Promise<number> {
  let ok = 0;
  for (const step of steps) {
    try {
      await runStep(page, step, base, query);
      ok += 1;
    } catch (err) {
      onError?.(step, err);
    }
  }
  // Let any final XHR-driven results render before the caller harvests links.
  await page.waitForTimeout(1500);
  return ok;
}
