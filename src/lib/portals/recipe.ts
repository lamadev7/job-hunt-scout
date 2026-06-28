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

/**
 * One action in a recipe's navigation+filter script. Together the steps drive a
 * real browser FROM the portal's base url TO the filtered results feed — this is
 * how we "remember the route + filters" so later runs replay instead of relearn.
 * `url`/`value` may carry the placeholders {role} {location} {sinceDays} {remote}.
 */
export const stepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string().min(1) }),
  z.object({ action: z.literal("fill"), selector: z.string().min(1), value: z.string().default("") }),
  z.object({ action: z.literal("click"), selector: z.string().min(1) }),
  z.object({ action: z.literal("select"), selector: z.string().min(1), value: z.string().default("") }),
  z.object({ action: z.literal("press"), selector: z.string().default(""), key: z.string().min(1) }),
  z.object({ action: z.literal("waitFor"), selector: z.string().optional(), ms: z.number().int().min(0).max(15000).optional() }),
]);
export type Step = z.infer<typeof stepSchema>;

export type Recipe = {
  portal: string;
  steps: Step[]; // [] => fall back to searchUrlTemplate (a single implicit goto)
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
  steps: z.array(stepSchema).default([]),
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

/**
 * Fill the {role} {location} {sinceDays} {remote} placeholders in a step's url or
 * value with this run's query. Used by the step replayer so the SAME saved script
 * applies the right filters for each search. `forUrl` percent-encodes (urls); a
 * `fill` value is typed raw into an input so it must NOT be encoded.
 */
export function substitute(raw: string, query: SearchQuery, forUrl: boolean): string {
  const role = query.role ?? "";
  const location = query.location ?? (query.remoteOnly ? "Remote" : "");
  const enc = (s: string) => (forUrl ? encodeURIComponent(s) : s);
  return raw
    .replaceAll("{role}", enc(role))
    .replaceAll("{location}", enc(location))
    .replaceAll("{sinceDays}", String(sinceDays(query.since)))
    .replaceAll("{remote}", query.remoteOnly ? "1" : "");
}

/**
 * Validate + normalize an untrusted LLM payload that may include a `steps` script.
 * Drops any step that fails its schema (so one bad step can't poison the whole
 * recipe) and rejects the draft only if the one thing we truly need — a compilable
 * job-link regex — is missing/invalid.
 */
export function coerceRecipeDraftWithSteps(raw: unknown): RecipeDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const cleanSteps: Step[] = [];
  if (Array.isArray(obj.steps)) {
    for (const s of obj.steps) {
      const parsed = stepSchema.safeParse(s);
      if (parsed.success) cleanSteps.push(parsed.data);
    }
  }
  const parsed = recipeDraftSchema.safeParse({ ...obj, steps: cleanSteps });
  if (!parsed.success) return null;
  if (!isValidRegex(parsed.data.jobLinkRegex)) return null;
  return parsed.data;
}
