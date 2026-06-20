import { prisma } from "@/lib/db";
import type { JobRecord, SearchQuery } from "@/lib/portals/adapter";
import { getAdapterFor } from "@/lib/portals/registry";
import { ensureDefaultPortals } from "@/lib/portals/bootstrap";
import { scoreJob } from "@/lib/matching/engine";
import { wordSuggestions } from "@/lib/llm/client";
import { getActiveProfile, rowToStructured } from "@/lib/profile";
import { getSettings } from "@/lib/settings";
import { recomputeMilestones } from "./milestones";

export type PostedWindow = "24h" | "2d" | "7d" | "30d" | "custom";

export type RunParams = {
  portals: string[];
  role?: string;
  location?: string;
  remoteOnly?: boolean;
  threshold: number; // min matchPct to save (0..100)
  postedWithin?: PostedWindow; // how recent a posting must be
  since?: string; // ISO cutoff (used when postedWithin === "custom")
};

/** Resolve the "posted within" choice to an absolute ISO cutoff. */
export function resolveSince(postedWithin?: PostedWindow, since?: string): string {
  const day = 86_400_000;
  const now = Date.now();
  switch (postedWithin) {
    case "2d": return new Date(now - 2 * day).toISOString();
    case "7d": return new Date(now - 7 * day).toISOString();
    case "30d": return new Date(now - 30 * day).toISOString();
    case "custom": {
      const t = since ? Date.parse(since) : NaN;
      return Number.isNaN(t) ? new Date(now - day).toISOString() : new Date(t).toISOString();
    }
    case "24h":
    default:
      return new Date(now - day).toISOString();
  }
}

export type MatchEvent = {
  company: string;
  position: string;
  postedAt: string;
  matchPct: number;
  url: string | null;
};

export type RunSummary = {
  evaluated: number;
  matched: number;
  skipped: number;
  topMatches: { company: string; position: string; matchPct: number }[];
  errors: string[];
};

/** Live progress events streamed to the UI as the agent works. */
export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "match"; match: MatchEvent }
  | { type: "skip"; position: string; matchPct: number }
  | { type: "done"; summary: RunSummary }
  | { type: "error"; message: string };

type Emit = (e: AgentEvent) => void;

/**
 * The agent loop (SHORTLIST mode — never applies):
 *  1. load the active structured profile
 *  2. open the portal, wait for sign-in, scroll Remote jobs from the last 24h
 *  3. read each JD, deterministically match vs the profile (provable set math)
 *  4. SAVE matches (matchPct >= threshold) to history as it finds them, emitting
 *     a live event per job; everything below is skipped
 *  5. rebuild learning milestones from the new gap data
 */
export async function runAgent(params: RunParams, emit: Emit = () => {}): Promise<RunSummary> {
  const profileRow = await getActiveProfile();
  if (!profileRow) {
    throw new Error("No active profile. Upload a resume first.");
  }
  const profile = rowToStructured(profileRow);
  const settings = await getSettings();

  const query: SearchQuery = {
    portals: params.portals,
    role: params.role,
    location: params.location,
    remoteOnly: true,
    since: resolveSince(params.postedWithin, params.since),
  };

  // Resolve which portals to run. Empty selection = all enabled portals.
  await ensureDefaultPortals();
  let portalNames = params.portals;
  if (portalNames.length === 0) {
    const enabled = await prisma.portal.findMany({ where: { enabled: true }, select: { name: true } });
    portalNames = enabled.map((p) => p.name);
  }
  if (portalNames.length === 0) {
    throw new Error("No job portals configured. Add a portal in My Details first.");
  }

  // Skip jobs already saved for this profile (idempotent re-runs).
  const existing = await prisma.application.findMany({
    where: { profileId: profileRow.id },
    select: { jobId: true },
  });
  const seen = new Set(existing.map((e) => e.jobId));

  const summary: RunSummary = {
    evaluated: 0,
    matched: 0,
    skipped: 0,
    topMatches: [],
    errors: [],
  };

  // Process one scraped job: analyze JD vs profile, save + stream if it matches.
  const onJob = async (job: JobRecord) => {
    if (seen.has(job.id)) return;
    seen.add(job.id);
    summary.evaluated += 1;

    const result = scoreJob(profile, job);
    if (result.matchPct < params.threshold) {
      summary.skipped += 1;
      emit({ type: "skip", position: job.position, matchPct: result.matchPct });
      return;
    }
    summary.matched += 1;

    // Auto-apply queueing (when enabled): queue jobs the agent can act on —
    // every Easy-Apply match (it can auto-fill these), plus any perfect (100%)
    // match (external ones resolve to "external" at apply time so you open them
    // on the portal). The agent never submits during the scan.
    const queued = settings.autoApplyEnabled && (job.easyApply || result.matchPct === 100);

    const suggestions = await wordSuggestions(result.missingTerms, job.position);
    await prisma.application.create({
      data: {
        jobId: job.id,
        profileId: profileRow.id,
        status: "matched", // saved to history, NOT applied
        matchPct: result.matchPct,
        fitScore: result.fitScore,
        matchedTerms: result.matchedTerms,
        missingTerms: result.missingTerms,
        suggestions,
        applyState: queued ? "queued" : "not_attempted",
      },
    });

    summary.topMatches.push({ company: job.company, position: job.position, matchPct: result.matchPct });
    emit({
      type: "match",
      match: {
        company: job.company,
        position: job.position,
        postedAt: job.postedAt,
        matchPct: result.matchPct,
        url: job.url,
      },
    });
  };

  const hooks = { onStatus: (m: string) => emit({ type: "status", message: m }), onJob };

  // Friendly labels for per-portal status lines.
  const portalRows = await prisma.portal.findMany({
    where: { name: { in: portalNames } },
    select: { name: true, label: true },
  });
  const labelOf = (n: string) => portalRows.find((p) => p.name === n)?.label ?? n;

  // Scan every selected portal at the same time, each scoped to its own portal
  // so results are correctly tagged. A failing portal records an error but never
  // aborts the others.
  await Promise.all(
    portalNames.map(async (name) => {
      emit({ type: "status", message: `Scanning ${labelOf(name)}…` });
      try {
        await getAdapterFor(name).fetchJobs({ ...query, portals: [name] }, hooks);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "fetch failed";
        summary.errors.push(`${labelOf(name)}: ${msg}`);
        emit({ type: "error", message: `${labelOf(name)}: ${msg}` });
      }
    })
  );

  summary.topMatches.sort((a, b) => b.matchPct - a.matchPct);
  summary.topMatches = summary.topMatches.slice(0, 5);

  emit({ type: "status", message: "Updating milestones…" });
  await recomputeMilestones();

  emit({ type: "done", summary });
  return summary;
}
