import { mockPortalAdapter, type PortalAdapter } from "./adapter";
import { linkedinAdapter } from "./linkedin";
import { indeedAdapter } from "./indeed";

/**
 * Real (browser-driven) adapters, keyed by portal name. Adding a portal later
 * is a one-line registration here (plus listing it in REAL_PORTALS).
 */
const REAL: Record<string, PortalAdapter> = {
  linkedin: linkedinAdapter,
  indeed: indeedAdapter,
};

/**
 * A portal runs for real (browser-driven) iff it has a registered adapter
 * above. No env required — any portal without a real adapter (Monster, etc.)
 * falls back to the mock source automatically.
 */
export function isReal(portal: string): boolean {
  return portal.toLowerCase() in REAL;
}

/** Adapter used to FETCH/APPLY for a given portal (real when enabled, else mock). */
export function getAdapterFor(portal: string): PortalAdapter {
  return isReal(portal) ? REAL[portal.toLowerCase()] : mockPortalAdapter;
}

/** The real adapter for a portal regardless of the gate — for session/login ops. */
export function getRealAdapter(portal: string): PortalAdapter | null {
  return REAL[portal.toLowerCase()] ?? null;
}
