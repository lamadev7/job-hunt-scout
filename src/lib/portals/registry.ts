import { type PortalAdapter } from "./adapter";
import { linkedinAdapter } from "./linkedin";
import { indeedAdapter } from "./indeed";
import { makeGenericAdapter } from "./generic";

/**
 * Site-specific (hand-tuned) adapters, keyed by portal name. Their static
 * scrapers proved brittle (hardcoded selectors harvested nav links as "jobs"),
 * so SEARCH now runs through the intelligent generic learner for every portal —
 * it reads each site's real filter fields and maps the search intent onto them
 * (see learn.ts). We still borrow a tuned adapter's APPLY/login where it adds
 * value (e.g. LinkedIn Easy-Apply auto-fill).
 */
const REAL: Record<string, PortalAdapter> = {
  indeed: indeedAdapter,
};

/**
 * LinkedIn: intelligent generic SEARCH (filters via the learned recipe) + the
 * tuned Easy-Apply automation. Composed so we drop the broken static search but
 * keep the valuable apply/login behavior.
 */
function linkedinComposed(): PortalAdapter {
  const g = generic("linkedin");
  return {
    name: "linkedin",
    fetchJobs: (q, h) => g.fetchJobs(q, h),
    applyJob: linkedinAdapter.applyJob,
    isLoggedIn: linkedinAdapter.isLoggedIn,
    openLogin: linkedinAdapter.openLogin,
  };
}

/** Generic adapters are memoized per portal name so state (connected flag) sticks. */
const GENERIC = new Map<string, PortalAdapter>();
function generic(portal: string): PortalAdapter {
  const key = portal.toLowerCase();
  let a = GENERIC.get(key);
  if (!a) {
    a = makeGenericAdapter(key);
    GENERIC.set(key, a);
  }
  return a;
}

/**
 * EVERY portal runs for real (browser-driven) now: known portals use their tuned
 * adapter, the rest use the generic browser adapter. No portal falls back to the
 * mock source, so all portals get a Connect gate AND real automation.
 */
export function isReal(): boolean {
  return true;
}

/** Adapter used to FETCH/APPLY for a given portal (tuned when available, else generic). */
export function getAdapterFor(portal: string): PortalAdapter {
  const key = portal.toLowerCase();
  if (key === "linkedin") return linkedinComposed();
  return REAL[key] ?? generic(key);
}

/** The real adapter for a portal — for session/login ops. Always present now. */
export function getRealAdapter(portal: string): PortalAdapter | null {
  const key = portal.toLowerCase();
  if (key === "linkedin") return linkedinComposed();
  return REAL[key] ?? generic(key);
}
