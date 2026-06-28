import { prisma } from "@/lib/db";
import { stepSchema, type Recipe, type RecipeDraft, type Step } from "./recipe";

/**
 * Persistence for learned portal recipes. Split from recipe.ts (pure logic) so
 * the substitution/validation functions stay unit-testable without a DB.
 */

type RecipeRow = {
  portal: string;
  steps: unknown; // Prisma Json — validated back into Step[] on read
  searchUrlTemplate: string;
  jobLinkRegex: string;
  titleSelector: string;
  companySelector: string;
  jdSelector: string;
  postedSelector: string;
  confidence: number;
  status: string;
};

/** Re-validate the stored JSON into a typed Step[], dropping anything malformed. */
function parseSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  const out: Step[] = [];
  for (const s of raw) {
    const parsed = stepSchema.safeParse(s);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function rowToRecipe(r: RecipeRow): Recipe {
  return {
    portal: r.portal,
    steps: parseSteps(r.steps),
    searchUrlTemplate: r.searchUrlTemplate,
    jobLinkRegex: r.jobLinkRegex,
    titleSelector: r.titleSelector,
    companySelector: r.companySelector,
    jdSelector: r.jdSelector,
    postedSelector: r.postedSelector,
    confidence: r.confidence,
  };
}

/** Load an ACTIVE recipe for a portal. Returns null if none or it's flagged failed. */
export async function loadRecipe(portal: string): Promise<Recipe | null> {
  const row = await prisma.portalRecipe.findUnique({ where: { portal } });
  if (!row || row.status !== "active") return null;
  return rowToRecipe(row);
}

/** Persist a freshly-learned, validated recipe (upsert — re-learning replaces it). */
export async function saveRecipe(draft: RecipeDraft, portal: string, sampleJobUrl: string): Promise<Recipe> {
  const data = {
    portal,
    steps: draft.steps,
    searchUrlTemplate: draft.searchUrlTemplate,
    jobLinkRegex: draft.jobLinkRegex,
    titleSelector: draft.titleSelector,
    companySelector: draft.companySelector,
    jdSelector: draft.jdSelector,
    postedSelector: draft.postedSelector,
    confidence: draft.confidence,
    status: "active",
    sampleJobUrl,
  };
  const row = await prisma.portalRecipe.upsert({
    where: { portal },
    create: data,
    update: { ...data, learnedAt: new Date() },
  });
  return rowToRecipe(row);
}

/** Flag a recipe failed so the next run re-learns it (self-heal). No-op if absent. */
export async function markRecipeFailed(portal: string): Promise<void> {
  await prisma.portalRecipe.updateMany({ where: { portal }, data: { status: "failed" } });
}
