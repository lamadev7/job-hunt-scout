import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

/**
 * Single persistent Chromium context shared across the whole app.
 *
 * We use launchPersistentContext so the login session (cookies, localStorage)
 * is written to disk and survives restarts — the user logs into each portal
 * ONCE in this window, and every later agent run reuses that session. No
 * passwords are ever stored by us; the portal's own cookies do the auth.
 *
 * Headed by default so the user can watch, solve a CAPTCHA, or complete a
 * login challenge. Set PORTAL_HEADLESS=1 to hide it (not recommended).
 */

const PROFILE_DIR = path.join(process.cwd(), ".browser-profile");

const globalForBrowser = globalThis as unknown as {
  __portalContext?: BrowserContext;
  __portalLaunch?: Promise<BrowserContext>;
  __portalPages?: Map<string, Page>;
};

async function launch(): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: process.env.PORTAL_HEADLESS === "1",
    viewport: { width: 1280, height: 900 },
    // A real desktop UA reduces (does not eliminate) bot heuristics.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  ctx.on("close", () => {
    globalForBrowser.__portalContext = undefined;
    globalForBrowser.__portalLaunch = undefined;
    globalForBrowser.__portalPages = undefined;
  });
  return ctx;
}

/** Get the shared context, launching it (once) if needed. Concurrency-safe. */
export async function getContext(): Promise<BrowserContext> {
  if (globalForBrowser.__portalContext) return globalForBrowser.__portalContext;
  if (!globalForBrowser.__portalLaunch) {
    globalForBrowser.__portalLaunch = launch().then((ctx) => {
      globalForBrowser.__portalContext = ctx;
      return ctx;
    });
  }
  return globalForBrowser.__portalLaunch;
}

/** Open a fresh page on the shared context. Caller must close it. */
export async function newPage(): Promise<Page> {
  const ctx = await getContext();
  return ctx.newPage();
}

/**
 * Get a dedicated, reusable page (tab) for a portal. Each portal gets its OWN
 * tab so concurrent scans (e.g. LinkedIn + Indeed at once) don't fight over a
 * shared page — sharing one page makes simultaneous navigations abort each
 * other (net::ERR_ABORTED). The first requester reuses the blank initial tab.
 */
export async function getPage(key: string): Promise<Page> {
  const ctx = await getContext();
  const map = (globalForBrowser.__portalPages ??= new Map<string, Page>());
  const existing = map.get(key);
  if (existing && !existing.isClosed()) return existing;

  const claimed = new Set(map.values());
  let page = ctx.pages().find((p) => !claimed.has(p) && !p.isClosed());
  if (!page) page = await ctx.newPage();
  map.set(key, page);
  return page;
}

/** True if the browser is already running — lets callers avoid launching it just to poll status. */
export function isLaunched(): boolean {
  return Boolean(globalForBrowser.__portalContext);
}

/** True if a persistent profile already exists on disk (user logged in before). */
export function hasProfile(): boolean {
  // Presence of the dir is enough; per-portal auth is checked by each adapter.
  return existsSync(PROFILE_DIR);
}

const SHOTS_DIR = path.join(process.cwd(), "public", "uploads", "screenshots");

/** Capture a step screenshot for the apply audit trail. Returns a public path
 *  (under /uploads/screenshots) or "" if capture failed. Never throws. */
export async function screenshot(page: Page, label: string): Promise<string> {
  try {
    await mkdir(SHOTS_DIR, { recursive: true });
    const safe = label.replace(/[^\w-]+/g, "_");
    const rel = `/uploads/screenshots/${Date.now()}-${safe}-${randomUUID().slice(0, 8)}.png`;
    await page.screenshot({ path: path.join(process.cwd(), "public", rel.slice(1)) });
    return rel;
  } catch {
    return "";
  }
}

export async function closeBrowser(): Promise<void> {
  const ctx = globalForBrowser.__portalContext;
  globalForBrowser.__portalContext = undefined;
  globalForBrowser.__portalLaunch = undefined;
  globalForBrowser.__portalPages = undefined;
  if (ctx) await ctx.close();
}
