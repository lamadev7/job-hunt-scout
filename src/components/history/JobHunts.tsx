"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, Loader2 } from "lucide-react";
import { getJSON, sendJSON, type ApplicationItem, type ProfileResponse } from "@/lib/api";
import { PageHeader, Chip, Skeleton, Card, Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/toast";
import { JobCard } from "@/components/history/JobCard";
import { JobDetail } from "@/components/history/JobDetail";
import { AgentRunPanel } from "@/components/details/AgentRunPanel";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "applied", label: "Applied" },
  { key: "matched", label: "Profile Matching" },
];

export function JobHunts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useDebounce(q, setDebounced);

  const clear = useMutation({
    mutationFn: () => sendJSON<{ cleared: number }>("/api/applications", undefined, "DELETE"),
    onSuccess: (res) => {
      setConfirmClear(false);
      setSelectedId(null);
      toast.success(`Cleared ${res.cleared} saved ${res.cleared === 1 ? "result" : "results"}.`);
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["milestones"] });
      qc.invalidateQueries({ queryKey: ["strength"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: profileData } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getJSON<ProfileResponse>("/api/resume"),
  });
  const hasProfile = !!profileData?.profile;
  const targetRole = profileData?.profile?.targetRole ?? "";

  const qs = new URLSearchParams({ status, ...(debounced && { q: debounced }) }).toString();
  const { data, isLoading } = useQuery({
    queryKey: ["applications", status, debounced],
    queryFn: () => getJSON<{ items: ApplicationItem[] }>(`/api/applications?${qs}`),
  });

  const items = data?.items ?? [];
  // Derived selection — if a filter/refresh drops the selected item, this falls
  // back to null and the grid shows again (no effect / setState needed).
  const selected = items.find((a) => a.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Job hunts"
        subtitle="Every job your agent searched, matched, and applied to."
        action={
          <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)} disabled={clear.isPending}>
            <Trash2 size={14} /> Clear history
          </Button>
        }
      />

      <div className="flex h-[calc(100dvh-12rem)] flex-col gap-5 lg:flex-row">
        {/* ---- left: the agent form ---- */}
        <aside className="w-full shrink-0 overflow-y-auto pr-1 lg:w-[420px]">
          <AgentRunPanel key={targetRole || "no-role"} hasProfile={hasProfile} defaultRole={targetRole} />
        </aside>

        {/* ---- right: search + chip filter on top, results below ---- */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search company or role…"
              className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm"
            />
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <Chip key={f.key} active={status === f.key} onClick={() => setStatus(f.key)}>
                  {f.label}
                </Chip>
              ))}
            </div>
            {!isLoading && items.length > 0 && (
              <span className="text-[11px] text-ink-faint">
                {items.length} {items.length === 1 ? "result" : "results"} (max 50)
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {selected ? (
              <JobDetail app={selected} onBack={() => setSelectedId(null)} />
            ) : isLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-72" />
                ))}
              </div>
            ) : items.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((a) => (
                  <JobCard key={a.id} app={a} onSelect={(app) => setSelectedId(app.id)} selected={selectedId === a.id} />
                ))}
              </div>
            ) : (
              <Card className="flex h-64 flex-col items-center justify-center text-center">
                <div className="text-sm font-medium">No job hunts yet</div>
                <div className="text-xs text-ink-faint">Run the agent on the left to search, match, and save jobs here.</div>
              </Card>
            )}
          </div>
        </section>
      </div>

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear job-search history?" className="max-w-md">
        <div className="p-5">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
              <Trash2 size={18} />
            </div>
            <p className="text-sm leading-relaxed text-ink-soft">
              This permanently removes all saved matches and applied jobs from your history. Your scraped job
              pool and profile are kept. This can’t be undone.
            </p>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)} disabled={clear.isPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>
              {clear.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Clear history
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function useDebounce(value: string, setter: (v: string) => void, delay = 300) {
  useEffect(() => {
    const t = setTimeout(() => setter(value), delay);
    return () => clearTimeout(t);
  }, [value, setter, delay]);
}
