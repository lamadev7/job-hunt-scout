"use client";

import { cn } from "@/lib/utils";

export type RangeKey = "today" | "yesterday" | "week" | "month" | "custom";

const OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "custom", label: "Custom" },
];

export function DateRangeFilter({
  value,
  onChange,
  from,
  to,
  onFrom,
  onTo,
}: {
  value: RangeKey;
  onChange: (k: RangeKey) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl border border-border bg-surface p-1">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              value === o.key ? "bg-brand text-white" : "text-ink-soft hover:text-ink"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => onFrom(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <span className="text-ink-faint">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => onTo(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          />
        </div>
      )}
    </div>
  );
}
