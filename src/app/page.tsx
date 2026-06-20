"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Target, TrendingUp, Users, Sparkles } from "lucide-react";
import Link from "next/link";
import { getJSON } from "@/lib/api";
import type { DashboardStats } from "@/lib/types";
import { Card, PageHeader, ProgressRing, Badge, Button, Skeleton } from "@/components/ui/primitives";
import { StatCard } from "@/components/dashboard/StatCard";
import { DateRangeFilter, type RangeKey } from "@/components/dashboard/DateRangeFilter";
import { TimelineChart, PortalBarChart } from "@/components/dashboard/Charts";

export default function DashboardPage() {
  const [range, setRange] = useState<RangeKey>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const qs = new URLSearchParams({ range, ...(from && { from }), ...(to && { to }) }).toString();
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", range, from, to],
    queryFn: () => getJSON<{ stats: DashboardStats }>(`/api/analytics?${qs}`),
  });

  const s = data?.stats;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="What your agent has been doing across portals."
        action={
          <Link href="/details">
            <Button size="sm" variant="subtle">
              <Sparkles size={16} /> Run Agent
            </Button>
          </Link>
        }
      />

      <div className="mb-6">
        <DateRangeFilter value={range} onChange={setRange} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {isLoading || !s ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Jobs Applied" value={s.totalApplied} icon={<Briefcase size={20} />} hint="Auto-applied by the agent" />
            <StatCard label="Matching Profiles" value={s.totalMatched} tone="success" icon={<Target size={20} />} hint="Jobs above the match floor" />
            <StatCard label="Avg Match" value={`${s.avgMatchPct}%`} tone="brand" icon={<TrendingUp size={20} />} hint="Skill coverage vs JD" />
            <StatCard label="Avg Applicants" value={s.avgApplicants} tone="warn" icon={<Users size={20} />} hint="Competition per post" />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-1">
              <div className="text-sm font-semibold">Shortlist Probability</div>
              <p className="mt-1 text-xs text-ink-faint">
                Composite estimate — not a guarantee. Built only from signals we can measure.
              </p>
              <div className="mt-4 flex items-center gap-5">
                <ProgressRing value={s.avgFitScore} size={96} stroke={9} />
                <div className="space-y-2 text-sm">
                  <Row label="Profile match" value={`${s.avgMatchPct}%`} />
                  <Row label="Avg applicants" value={String(s.avgApplicants)} />
                  <Row label="Applied" value={String(s.totalApplied)} />
                </div>
              </div>
            </Card>

            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 text-sm font-semibold">Activity Timeline</div>
              {s.timeline.length ? (
                <TimelineChart data={s.timeline} />
              ) : (
                <Empty>No activity in this range.</Empty>
              )}
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-3 text-sm font-semibold">Applications by Portal</div>
              {s.byPortal.length ? <PortalBarChart data={s.byPortal} /> : <Empty>No data.</Empty>}
            </Card>

            <Card className="p-5">
              <div className="mb-1 text-sm font-semibold">Top Missing Skills</div>
              <p className="mb-4 text-xs text-ink-faint">Most common gaps across your applications.</p>
              {s.topMissing.length ? (
                <div className="flex flex-wrap gap-2">
                  {s.topMissing.map((m) => (
                    <Badge key={m.term} tone="warn">
                      {m.term} <span className="opacity-60">×{m.count}</span>
                    </Badge>
                  ))}
                </div>
              ) : (
                <Empty>No gaps detected.</Empty>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-ink-soft">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-32 items-center justify-center text-sm text-ink-faint">{children}</div>;
}
