"use client";

import { Building2, MapPin, Users, Lightbulb, ExternalLink } from "lucide-react";
import { Card, Badge, ProgressRing, ProgressBar } from "@/components/ui/primitives";
import { experienceFit } from "@/lib/matching/engine";
import type { ApplicationItem } from "@/lib/api";

export function JobCard({
  app,
  onSelect,
  selected,
}: {
  app: ApplicationItem;
  onSelect?: (app: ApplicationItem) => void;
  selected?: boolean;
}) {
  const { job } = app;
  const exp = job.yearsRequired > 0 ? experienceFit(app.profileYears, job.yearsRequired) : null;
  const expShort = exp && !exp.meets;
  return (
    <Card
      onClick={onSelect ? () => onSelect(app) : undefined}
      className={
        "p-5 animate-fade-up" +
        (onSelect ? " cursor-pointer transition-shadow hover:shadow-md" : "") +
        (selected ? " ring-2 ring-brand" : "")
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Building2 size={18} />
            </div>
            <div className="min-w-0">
              {job.url ? (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="group flex items-center gap-1 truncate font-semibold text-brand hover:underline"
                  title="Open job post in a new tab"
                >
                  <span className="truncate">{job.position}</span>
                  <ExternalLink size={13} className="shrink-0 opacity-70 group-hover:opacity-100" />
                </a>
              ) : (
                <div className="truncate font-semibold">{job.position}</div>
              )}
              <div className="truncate text-sm text-ink-soft">{job.company}</div>
            </div>
          </div>
        </div>
        <div className="text-center">
          <ProgressRing value={app.matchPct} size={58} stroke={6} />
          <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-faint">match</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
        <span className="flex items-center gap-1"><MapPin size={13} /> {job.location}</span>
        <span className="flex items-center gap-1"><Users size={13} /> {job.applicantCount} applicants</span>
        <span className="capitalize">{job.portal}</span>
        <Badge tone={app.status === "applied" ? "success" : "warn"}>
          {app.status === "applied" ? "Applied" : "Profile match"}
        </Badge>
      </div>

      {app.matchedTerms.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-medium text-ink-soft">Matching terms</div>
          <div className="flex flex-wrap gap-1.5">
            {app.matchedTerms.map((t) => (
              <Badge key={t} tone="success">{t}</Badge>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-medium text-ink-soft">Shortlist probability</span>
          <span className="font-semibold">{app.fitScore}%</span>
        </div>
        <ProgressBar value={app.fitScore} />
      </div>

      {(app.missingTerms.length > 0 || expShort) && (
        <div className="mt-4 rounded-xl bg-warn-soft/60 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warn">
            <Lightbulb size={14} /> {expShort ? "Gaps to close:" : "To reach 100% match, add:"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {expShort && (
              <Badge tone="warn">Experience: {job.yearsRequired}+ yrs · you have {app.profileYears}</Badge>
            )}
            {app.missingTerms.map((t) => (
              <Badge key={t} tone="warn">{t}</Badge>
            ))}
          </div>
          {app.suggestions.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-soft">
              {app.suggestions.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-warn">•</span> {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
