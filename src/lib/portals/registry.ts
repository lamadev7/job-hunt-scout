import { type PortalAdapter } from "./adapter";
import { linkedinAdapter } from "./linkedin";
import { indeedAdapter } from "./indeed";
import { makeGenericAdapter } from "./generic";

/**
 * Site-specific (hand-tuned) adapters, keyed by portal name. LinkedIn/Indeed
 * have bespoke scrapers; every OTHER portal is driven by the generic adapter
 * below — so adding a portal needs no code, just a name + URL.
 */
const REAL: Record<string, PortalAdapter> = {
  linkedin: linkedinAdapter,
  indeed: indeedAdapter,
};

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
  return REAL[portal.toLowerCase()] ?? generic(portal);
}

/** The real adapter for a portal — for session/login ops. Always present now. */
export function getRealAdapter(portal: string): PortalAdapter | null {
  return REAL[portal.toLowerCase()] ?? generic(portal);
}
