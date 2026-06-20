"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Users,
  Clock,
  DollarSign,
  Briefcase,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Target,
} from "lucide-react";
import { Card, Badge, ProgressRing, ProgressBar, Button } from "@/components/ui/primitives";
import type { ApplicationItem } from "@/lib/api";

function salaryLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  if (min != null && max != null) return `${k(min)}–${k(max)}`;
  return k((min ?? max)!);
}

function posted(iso: string): string {
  try {
    return `${formatDistanceToNow(new Date(iso))} ago`;
  } catch {
    return "recently";
  }
}

function Stat({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-xs text-ink-faint">
      <Icon size={13} /> {children}
    </span>
  );
}

export function JobDetail({ app, onBack }: { app: ApplicationItem; onBack: () => void }) {
  const { job } = app;
  const salary = salaryLabel(job.salaryMin, job.salaryMax);

  return (
    <div className="animate-fade-up space-y-4">
      <Button variant="outline" className="h-8 px-3 text-xs" onClick={onBack}>
        <ArrowLeft size={14} /> Back to all
      </Button>

      {/* header */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <Building2 size={20} />
              </div>
              <div className="min-w-0">
                {job.url ? (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-1.5 text-lg font-semibold text-brand hover:underline"
                    title="Open job post in a new tab"
                  >
                    <span className="truncate">{job.position}</span>
                    <ExternalLink size={15} className="shrink-0 opacity-70 group-hover:opacity-100" />
                  </a>
                ) : (
                  <div className="text-lg font-semibold">{job.position}</div>
                )}
                <div className="text-sm text-ink-soft">{job.company}</div>
              </div>
            </div>
          </div>
          <div className="shrink-0 text-center">
            <ProgressRing value={app.matchPct} size={64} stroke={7} />
            <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-faint">match</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Stat icon={MapPin}>{job.location}{job.remote ? " · Remote" : ""}</Stat>
          <Stat icon={Briefcase}>{job.seniority} · {job.yearsRequired}+ yrs</Stat>
          <Stat icon={Users}>{job.applicantCount} applicants</Stat>
          <Stat icon={Clock}>{posted(job.postedAt)}</Stat>
          {salary && <Stat icon={DollarSign}>{salary}</Stat>}
          <Badge tone={app.status === "applied" ? "success" : "warn"}>
            {app.status === "applied" ? "Applied" : "Profile match"}
          </Badge>
          <span className="text-xs capitalize text-ink-faint">via {job.portal}</span>
        </div>

        {job.url && (
          <a href={job.url} target="_blank" rel="noopener noreferrer">
            <Button className="mt-4 w-full">
              <ExternalLink size={15} /> Open job post
            </Button>
          </a>
        )}
      </Card>

      {/* shortlist probability */}
      <Card className="p-5">
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-medium text-ink-soft">
            <Target size={15} /> Shortlist probability
          </span>
          <span className="font-semibold">{app.fitScore}%</span>
        </div>
        <ProgressBar value={app.fitScore} />
        <p className="mt-2 text-xs text-ink-faint">
          Composite of your match against requirements and how crowded the applicant pool is.
        </p>
      </Card>

      {/* matching criteria */}
      <Card className="p-5">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-success">
          <CheckCircle2 size={16} /> Matching criteria ({app.matchedTerms.length})
        </div>
        {app.matchedTerms.length ? (
          <div className="flex flex-wrap gap-1.5">
            {app.matchedTerms.map((t) => (
              <Badge key={t} tone="success">{t}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-faint">None of this job&apos;s terms are on your resume yet.</p>
        )}
      </Card>

      {/* not matching */}
      <Card className="p-5">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-danger">
          <XCircle size={16} /> Not matching ({app.missingTerms.length})
        </div>
        {app.missingTerms.length ? (
          <div className="flex flex-wrap gap-1.5">
            {app.missingTerms.map((t) => (
              <Badge key={t} tone="warn">{t}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-success">Perfect — your resume covers every listed criterion. 🎉</p>
        )}
      </Card>

      {/* reach 100% */}
      {app.missingTerms.length > 0 && (
        <Card className="bg-warn-soft/40 p-5">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-warn">
            <Lightbulb size={16} /> To reach 100% match
          </div>
          {app.suggestions.length ? (
            <ul className="space-y-1.5 text-sm text-ink-soft">
              {app.suggestions.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-warn">•</span> {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">
              Add hands-on experience with: {app.missingTerms.join(", ")}.
            </p>
          )}
        </Card>
      )}

      {/* full criteria context */}
      <Card className="p-5">
        <div className="mb-2 text-sm font-semibold">Required skills</div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {job.requiredSkills.length ? (
            job.requiredSkills.map((t) => {
              const have = app.matchedTerms.includes(t);
              return <Badge key={t} tone={have ? "success" : "warn"}>{t}</Badge>;
            })
          ) : (
            <span className="text-xs text-ink-faint">Not specified.</span>
          )}
        </div>
        <div className="mb-2 text-sm font-semibold">Nice to have</div>
        <div className="flex flex-wrap gap-1.5">
          {job.niceSkills.length ? (
            job.niceSkills.map((t) => {
              const have = app.matchedTerms.includes(t);
              return <Badge key={t} tone={have ? "success" : "neutral"}>{t}</Badge>;
            })
          ) : (
            <span className="text-xs text-ink-faint">Not specified.</span>
          )}
        </div>
      </Card>

      {/* job description */}
      {job.jd && (
        <Card className="p-5">
          <div className="mb-2 text-sm font-semibold">Job description</div>
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
            {job.jd}
          </div>
        </Card>
      )}
    </div>
  );
}
