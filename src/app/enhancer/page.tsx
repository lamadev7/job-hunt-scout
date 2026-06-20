"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Check, TrendingUp, Flame } from "lucide-react";
import { getJSON, sendJSON, type MilestoneRow, type StrengthCardRow } from "@/lib/api";
import { Card, PageHeader, Button, ProgressRing, ProgressBar, Badge, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type MilestonesResponse = {
  milestones: MilestoneRow[];
  strength: { cards: StrengthCardRow[]; overall: number };
};

export default function EnhancerPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["milestones"],
    queryFn: () => getJSON<MilestonesResponse>("/api/milestones"),
  });

  const recompute = useMutation({
    mutationFn: () => sendJSON("/api/milestones", undefined),
    onSuccess: () => {
      toast.success("Milestones rebuilt from your latest gaps.");
      qc.invalidateQueries({ queryKey: ["milestones"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (m: MilestoneRow) => sendJSON(`/api/milestones/${m.id}`, { done: !m.done }, "PATCH"),
    onSuccess: (_res, m) => {
      if (!m.done) toast.success(`"${m.skill}" added to your profile.`);
      qc.invalidateQueries({ queryKey: ["milestones"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  const milestones = data?.milestones ?? [];
  const cards = data?.strength.cards ?? [];
  const overall = data?.strength.overall ?? 0;
  const done = milestones.filter((m) => m.done).length;

  return (
    <div>
      <PageHeader
        title="AI Resume Enhancer"
        subtitle="The agent turns your application gaps into a prioritized learning path."
        action={
          <Button size="sm" variant="outline" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
            <RefreshCw size={15} className={recompute.isPending ? "animate-spin" : ""} /> Rebuild
          </Button>
        }
      />

      {/* Strength cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="flex items-center gap-4 p-5 animate-fade-up">
            <ProgressRing value={overall} size={72} stroke={8} />
            <div>
              <div className="text-sm font-semibold">Overall Strength</div>
              <div className="text-xs text-ink-faint">Across {cards.length} dimensions</div>
            </div>
          </Card>
          {cards.map((c) => (
            <Card key={c.key} className="p-5 animate-fade-up">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{c.label}</div>
                <span className="text-sm font-semibold">{c.value}<span className="text-ink-faint">/{c.total}</span></span>
              </div>
              <ProgressBar value={c.value} className="mt-3" />
              <div className="mt-2 text-xs text-ink-faint">{c.detail}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Milestones */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp size={16} className="text-brand" /> Learning Milestones
          </div>
          <span className="text-xs text-ink-faint">{done}/{milestones.length} completed</span>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : milestones.length ? (
          <div className="space-y-2">
            {milestones.map((m) => (
              <Card
                key={m.id}
                className={cn("flex items-center gap-4 p-4 transition-colors", m.done && "opacity-60")}
              >
                <button
                  onClick={() => toggle.mutate(m)}
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
                    m.done ? "border-success bg-success text-white" : "border-border hover:border-brand"
                  )}
                  aria-label="Toggle milestone"
                >
                  {m.done && <Check size={16} />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-medium", m.done && "line-through")}>{m.skill}</span>
                    <Badge tone="neutral">{m.category}</Badge>
                    {m.demandScore >= 0.8 && (
                      <Badge tone="danger"><Flame size={11} /> high demand</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-faint">{m.rationale}</div>
                </div>

                <div className="hidden text-right sm:block">
                  <div className="text-xs text-ink-faint">priority</div>
                  <div className="text-sm font-semibold text-brand">{m.priority}</div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="flex h-40 flex-col items-center justify-center text-center">
            <div className="text-sm font-medium">No milestones yet</div>
            <div className="text-xs text-ink-faint">Run the agent so it can learn your gaps, then rebuild.</div>
          </Card>
        )}
      </div>
    </div>
  );
}
