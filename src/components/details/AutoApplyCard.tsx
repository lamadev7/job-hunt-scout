"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Rocket, AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { getJSON, sendJSON } from "@/lib/api";
import { cn } from "@/lib/utils";

type Settings = { autoApplyEnabled: boolean; dailyCap: number; dryRunFirst: boolean };

export function AutoApplyCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getJSON<Settings>("/api/settings"),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => sendJSON<Settings>("/api/settings", patch, "PATCH"),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = data ?? { autoApplyEnabled: false, dailyCap: 10, dryRunFirst: true };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Rocket size={16} className="text-brand" /> Auto-apply
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        Queue <b>100% matches</b> on Easy-Apply posts for one-click review &amp; submit. The agent never
        answers screening questions for you — anything beyond one click is handed back to you.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Enable auto-apply</div>
          <div className="text-xs text-ink-faint">Off by default. Only queues; you approve each apply.</div>
        </div>
        <Toggle on={s.autoApplyEnabled} disabled={save.isPending} onChange={(v) => save.mutate({ autoApplyEnabled: v })} />
      </div>

      {s.autoApplyEnabled && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Daily submit cap</div>
              <div className="text-xs text-ink-faint">Max real submissions per day.</div>
            </div>
            <input
              type="number"
              min={1}
              max={100}
              value={s.dailyCap}
              onChange={(e) => save.mutate({ dailyCap: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
              className="h-9 w-20 rounded-lg border border-border bg-surface px-3 text-sm"
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Dry-run first</div>
              <div className="text-xs text-ink-faint">Fill the form &amp; screenshot, but don&apos;t submit.</div>
            </div>
            <Toggle on={s.dryRunFirst} disabled={save.isPending} onChange={(v) => save.mutate({ dryRunFirst: v })} />
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-xs text-warn">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Automated applying may violate a portal&apos;s terms and risks your account. Runs in a visible
              browser so you can watch; review each dry-run before trusting real submits.
            </span>
          </div>
        </>
      )}

      {save.isPending && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <Loader2 size={12} className="animate-spin" /> Saving…
        </div>
      )}
    </Card>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
        on ? "border-transparent bg-brand" : "border-border bg-surface-2"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
