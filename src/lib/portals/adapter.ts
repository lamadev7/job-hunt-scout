import { prisma } from "@/lib/db";
import { asArray } from "@/lib/utils";

export type JobRecord = {
  id: string; // our DB id (adapter is responsible for persisting + returning it)
  portal: string;
  externalId: string | null;
  url: string | null;
  company: string;
  position: string;
  location: string;
  remote: boolean;
  seniority: string;
  jd: string;
  requiredSkills: string[];
  niceSkills: string[];
  yearsRequired: number;
  applicantCount: number;
  salaryMin: number | null;
  salaryMax: number | null;
  easyApply: boolean; // on-site (automatable) apply available
  postedAt: string; // ISO string
};

export type SearchQuery = {
  portals: string[]; // portal names; empty = all
  role?: string; // free-text title filter
  location?: string;
  remoteOnly?: boolean;
  since?: string; // ISO cutoff — only jobs posted at/after this moment
};

/** Live hooks so the agent can stream progress per job as it scans. */
export type FetchHooks = {
  onStatus?: (message: string) => void;
  onJob?: (job: JobRecord) => Promise<void> | void;
};

export type ApplyOutcome = {
  state: "submitted" | "dry_run" | "failed" | "needs_human" | "skipped_external";
  error?: string;
  screenshots: string[];
};

/** Applicant identity used to auto-fill apply forms (from the active profile). */
export type ApplicantInfo = {
  fullName: string;
  email: string;
  phone: string;
  yearsExperience: number;
};

export type ApplyOpts = { resumePath: string | null; dryRun: boolean; applicant?: ApplicantInfo };

/**
 * A portal source. fetchJobs returns jobs ALREADY persisted to the Job table
 * (so `.id` is a real FK target). applyJob is optional — only real adapters
 * that can drive an on-site form implement it.
 */
export interface PortalAdapter {
  readonly name: string;
  fetchJobs(query: SearchQuery, hooks?: FetchHooks): Promise<JobRecord[]>;
  applyJob?(job: JobRecord, opts: ApplyOpts): Promise<ApplyOutcome>;
  /** Real adapters report whether the persistent session is authenticated. */
  isLoggedIn?(): Promise<boolean>;
  /** Open a headed window so the user can log in once. */
  openLogin?(): Promise<void>;
}

/**
 * Demo job pool is seeded for one portal (linkedin). When the user adds another
 * portal (indeed, etc.) it has zero jobs, so a scan would find nothing. The mock
 * source is a stand-in for a real scraper, so it should surface jobs for ANY
 * portal — we lazily clone the existing pool under the new portal's name the
 * first time it's scanned. Idempotent + deterministic (no random data).
 */
async function ensureMockPool(portalNames: string[]): Promise<void> {
  const names = portalNames.filter(Boolean);
  if (!names.length) return;

  // Template = the existing seeded jobs. Dedupe by company+position so we don't
  // multiply already-cloned portals (the pool grows each time a portal is added).
  // Nothing to clone from on a totally empty DB — separate "seed the app" concern.
  const all = await prisma.job.findMany({ orderBy: { postedAt: "desc" } });
  const seenKey = new Set<string>();
  const template = all.filter((t) => {
    const k = `${t.company}::${t.position}`;
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });
  if (!template.length) return;

  for (const name of names) {
    const have = await prisma.job.count({ where: { portal: name } });
    if (have > 0) continue;
    // Link the cloned listings to THIS portal's site, not the source portal's.
    const portalRow = await prisma.portal.findUnique({ where: { name }, select: { url: true } });
    const base = portalRow?.url?.replace(/\/+$/, "") || null;
    await prisma.job.createMany({
      data: template.map((t, i) => ({
        portal: name,
        externalId: t.externalId ? `${name}-${t.externalId}` : null,
        url: base ? `${base}/${i + 1}` : null,
        company: t.company,
        position: t.position,
        location: t.location,
        remote: t.remote,
        seniority: t.seniority,
        jd: t.jd,
        requiredSkills: t.requiredSkills as object,
        niceSkills: t.niceSkills as object,
        yearsRequired: t.yearsRequired,
        salaryMin: t.salaryMin,
        salaryMax: t.salaryMax,
        applicantCount: t.applicantCount,
        easyApply: t.easyApply,
        postedAt: t.postedAt,
      })),
    });
  }
}

/** Words too generic/seniority-ish to filter a job title on. */
const ROLE_STOPWORDS = new Set([
  "senior", "junior", "lead", "staff", "principal", "mid", "entry",
  "the", "and", "for", "remote", "full", "time", "contract",
]);

export const mockPortalAdapter: PortalAdapter = {
  name: "mock",
  /**
   * Simulated apply for demo/non-real portals. Honors the same contract as real
   * adapters so the full queue → apply → status pipeline is end-to-end testable
   * without a browser: external posts are skipped, dry-runs report dry_run, and
   * applicable posts report submitted.
   */
  async applyJob(job, { dryRun }) {
    if (!job.easyApply) return { state: "skipped_external", screenshots: [] };
    if (dryRun) return { state: "dry_run", screenshots: [] };
    return { state: "submitted", screenshots: [] };
  },
  async fetchJobs(query, hooks) {
    await ensureMockPool(query.portals);

    const baseWhere = {
      ...(query.portals.length ? { portal: { in: query.portals } } : {}),
      ...(query.location ? { location: { contains: query.location } } : {}),
      ...(query.remoteOnly ? { remote: true } : {}),
      ...(query.since ? { postedAt: { gte: new Date(query.since) } } : {}),
    };

    // Role is a soft hint, not an exact-string gate. "Full Stack Engineer"
    // should match "Fullstack Developer", "Software Engineer", etc., so we match
    // ANY meaningful token of the role against the position.
    const roleTokens = (query.role ?? "")
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((t) => t.length >= 3 && !ROLE_STOPWORDS.has(t));

    let rows = await prisma.job.findMany({
      where: roleTokens.length
        ? { ...baseWhere, OR: roleTokens.map((t) => ({ position: { contains: t } })) }
        : baseWhere,
      orderBy: { postedAt: "desc" },
    });

    // If the role is too narrow to match any title, don't return an empty scan —
    // fall back to the full portal pool and let resume matching rank them.
    if (rows.length === 0 && roleTokens.length) {
      rows = await prisma.job.findMany({ where: baseWhere, orderBy: { postedAt: "desc" } });
    }
    hooks?.onStatus?.(`Found ${rows.length} jobs. Analyzing…`);
    const records: JobRecord[] = [];
    for (const r of rows) {
      const rec: JobRecord = {
        id: r.id,
        portal: r.portal,
        externalId: r.externalId,
        url: r.url,
        company: r.company,
        position: r.position,
        location: r.location,
        remote: r.remote,
        seniority: r.seniority,
        jd: r.jd,
        requiredSkills: asArray(r.requiredSkills),
        niceSkills: asArray(r.niceSkills),
        yearsRequired: r.yearsRequired,
        applicantCount: r.applicantCount,
        salaryMin: r.salaryMin,
        salaryMax: r.salaryMax,
        easyApply: r.easyApply,
        postedAt: r.postedAt.toISOString(),
      };
      records.push(rec);
      await hooks?.onJob?.(rec);
    }
    return records;
  },
};
