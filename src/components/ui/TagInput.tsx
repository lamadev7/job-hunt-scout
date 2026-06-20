"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Editable chip list. Enter or comma adds, backspace removes last, × removes one. */
export function TagInput({
  value,
  onChange,
  placeholder = "Add and press Enter",
  tone = "brand",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  tone?: "brand" | "neutral" | "success";
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const toneCls = {
    brand: "bg-brand-soft text-brand-ink",
    neutral: "bg-surface-2 text-ink-soft",
    success: "bg-success-soft text-success",
  }[tone];

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface p-2">
      {value.map((t) => (
        <span key={t} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", toneCls)}>
          {t}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== t))}
            className="opacity-60 transition-opacity hover:opacity-100"
            aria-label={`Remove ${t}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => add(draft)}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[120px] flex-1 bg-transparent px-1.5 py-0.5 text-sm outline-none"
      />
    </div>
  );
}
