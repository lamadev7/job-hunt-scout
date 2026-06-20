import path from "node:path";
import { prisma } from "@/lib/db";
import { asArray } from "@/lib/utils";
import { getAdapterFor } from "@/lib/portals/registry";
import { getSettings, submittedToday } from "@/lib/settings";
import type { JobRecord } from "@/lib/portals/adapter";

export type ApplyResult = {
  ok: boolean;
  applicationId: string;
  state: string; // applyState after the attempt
  error?: string;
};

/** Build the adapter JobRecord shape from a persisted Job row. */
function rowToJobRecord(row: {
  id: string; portal: string; externalId: string | null; url: string | null;
  company: string; position: string; location: string; remote: boolean;
  seniority: string; jd: string; requiredSkills: unknown; niceSkills: unknown;
  yearsRequired: number; applicantCount: number; salaryMin: number | null;
  salaryMax: number | null; easyApply: boolean; postedAt: Date;
}): JobRecord {
  return {
    id: row.id,
    portal: row.portal,
    externalId: row.externalId,
    url: row.url,
    company: row.company,
    position: row.position,
    location: row.location,
    remote: row.remote,
    seniority: row.seniority,
    jd: row.jd,
    requiredSkills: asArray<string>(row.requiredSkills),
    niceSkills: asArray<string>(row.niceSkills),
    yearsRequired: row.yearsRequired,
    applicantCount: row.applicantCount,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    easyApply: row.easyApply,
    postedAt: row.postedAt.toISOString(),
  };
}

/**
 * Apply to a single saved application via its portal adapter. Defensive by
 * design: only Easy-Apply posts, enforces the daily cap on real submits, never
 * re-submits, and records the outcome (state, error, screenshots) for audit.
 */
export async function applyOne(applicationId: string, dryRun: boolean): Promise<ApplyResult> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { job: true, profile: { include: { files: { orderBy: { uploadedAt: "desc" } } } } },
  });
  if (!app || !app.job) {
    return { ok: false, applicationId, state: "failed", error: "Application or job not found." };
  }
  if (app.applyState === "submitted") {
    return { ok: false, applicationId, state: "submitted", error: "Already applied." };
  }

  const job = app.job;
  const adapter = getAdapterFor(job.portal);
  if (!adapter.applyJob) {
    return { ok: false, applicationId, state: "failed", error: `Portal "${job.portal}" can't auto-apply.` };
  }

  // Enforce the daily cap on REAL submits only (dry-runs are free).
  if (!dryRun) {
    const { dailyCap } = await getSettings();
    if ((await submittedToday()) >= dailyCap) {
      return { ok: false, applicationId, state: app.applyState, error: `Daily apply cap (${dailyCap}) reached.` };
    }
  }

  const resumeRel = app.profile?.files?.[0]?.path ?? null;
  const resumePath = resumeRel ? path.join(process.cwd(), "public", resumeRel.replace(/^\/?uploads\//, "uploads/")) : null;
  const applicant = app.profile
    ? {
        fullName: app.profile.fullName,
        email: app.profile.email,
        phone: app.profile.phone,
        yearsExperience: app.profile.yearsExperience,
      }
    : undefined;

  // The adapter opens the real browser, navigates to the job, and (for
  // Easy-Apply) attaches the resume + reaches the submit step — screenshotting
  // each step. External posts navigate + screenshot, then report skipped_external.
  let outcome;
  try {
    outcome = await adapter.applyJob(rowToJobRecord(job), { resumePath, dryRun, applicant });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Apply failed.";
    if (!dryRun) await mark(applicationId, "failed", [], msg);
    return { ok: false, applicationId, state: "failed", error: msg };
  }

  // Dry-run is a PREVIEW: store the screenshots/note for review but never change
  // applyState — the item stays queued so a later real apply still works.
  if (dryRun) {
    await prisma.application.update({
      where: { id: applicationId },
      data: { screenshots: outcome.screenshots ?? [], applyError: outcome.error ?? null, attemptedAt: new Date() },
    });
    return { ok: outcome.state === "dry_run", applicationId, state: outcome.state, error: outcome.error };
  }

  await mark(applicationId, outcome.state, outcome.screenshots ?? [], outcome.error, outcome.state === "submitted");
  return { ok: outcome.state === "submitted", applicationId, state: outcome.state, error: outcome.error };
}

async function mark(
  id: string,
  state: string,
  screenshots: string[],
  error?: string,
  submitted = false
) {
  await prisma.application.update({
    where: { id },
    data: {
      applyState: state,
      screenshots,
      applyError: error ?? null,
      attemptedAt: new Date(),
      appliedVia: "agent",
      ...(submitted ? { status: "applied" } : {}),
    },
  });
}
