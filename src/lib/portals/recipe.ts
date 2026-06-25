import { z } from "zod";
import type { SearchQuery } from "./adapter";

/**
 * A learned, validated scraping recipe for a portal with no hand-tuned adapter.
 * The browser/LLM learner (learn.ts) produces a `RecipeDraft`; once validated on
 * a live sample we persist it as a `PortalRecipe` (recipe-store.ts) and replay it
 * on later runs.
 *
 * This file is PURE — no browser, no LLM, no DB (only zod + a type-only import) —
 * so the substitution/validation logic is unit-testable in isolation.
 */

export type Recipe = {
  portal: string;
  searchUrlTemplate: string; // "" => use the portal's base url
  jobLinkRegex: string; // JS regex source, matched (case-insensitive) against absolute hrefs
  titleSelector: string; // "" => heuristic
  companySelector: string;
  jdSelector: string;
  postedSelector: string;
  confidence: number; // 0..1
};

/** Raw shape the LLM is asked to emit. Coerced/validated before use. */
export const recipeDraftSchema = z.object({
  searchUrlTemplate: z.string().default(""),
  jobLinkRegex: z.string().min(1),
  titleSelector: z.string().default(""),
  companySelector: z.string().default(""),
  jdSelector: z.string().default(""),
  postedSelector: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type RecipeDraft = z.infer<typeof recipeDraftSchema>;

/** True iff `src` compiles as a JS regex (so we never persist a poison pattern). */
export function isValidRegex(src: string): boolean {
  try {
    new RegExp(src, "i");
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate + normalize an untrusted LLM payload into a RecipeDraft. Returns null
 * if it's missing the one thing we truly need (a compilable job-link regex).
 */
export function coerceRecipeDraft(raw: unknown): RecipeDraft | null {
  const parsed = recipeDraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  const draft = parsed.data;
  if (!isValidRegex(draft.jobLinkRegex)) return null;
  return draft;
}

/** Whole days since the cutoff (min 1) — for sites whose filter is day-bucketed. */
export function sinceDays(sinceIso?: string): number {
  if (!sinceIso) return 1;
  const t = Date.parse(sinceIso);
  if (Number.isNaN(t)) return 1;
  return Math.max(1, Math.ceil((Date.now() - t) / 86_400_000));
}

/**
 * Build the results URL from a recipe + this run's query. Supported placeholders:
 *   {role} {location} {sinceDays} {remote}
 * An empty template falls back to the portal's base url (we filter client-side).
 */
export function buildSearchUrl(template: string, baseUrl: string, query: SearchQuery): string {
  if (!template.trim()) return baseUrl;
  return template
    .replaceAll("{role}", encodeURIComponent(query.role ?? ""))
    .replaceAll("{location}", encodeURIComponent(query.location ?? (query.remoteOnly ? "Remote" : "")))
    .replaceAll("{sinceDays}", String(sinceDays(query.since)))
    .replaceAll("{remote}", query.remoteOnly ? "1" : "");
}

/** Compile the recipe's job-link matcher once (case-insensitive). */
export function jobLinkMatcher(recipe: Pick<Recipe, "jobLinkRegex">): RegExp {
  return new RegExp(recipe.jobLinkRegex, "i");
}
