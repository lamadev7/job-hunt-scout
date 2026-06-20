"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Globe } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { getJSON, sendJSON, type PortalRow } from "@/lib/api";

export function PortalManager() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["portals"],
    queryFn: () => getJSON<{ portals: PortalRow[] }>("/api/portals"),
  });
  const portals = data?.portals ?? [];

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["portals"] });

  const add = useMutation({
    mutationFn: () => sendJSON("/api/portals", { label, url }),
    onSuccess: () => {
      toast.success("Portal added.");
      setLabel("");
      setUrl("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (p: PortalRow) => sendJSON(`/api/portals/${p.id}`, { enabled: !p.enabled }, "PATCH"),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => sendJSON(`/api/portals/${id}`, undefined, "DELETE"),
    onSuccess: () => {
      toast.success("Portal removed.");
      invalidate();
    },
  });

  return (
    <Card className="p-5">
      <div className="mb-1 text-sm font-semibold">Job Portals</div>
      <p className="mb-4 text-xs text-ink-faint">Sources the agent will search. Toggle or add your own.</p>

      <div className="space-y-2">
        {portals.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Globe size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {p.label}
                {p.enabled ? <Badge tone="success">on</Badge> : <Badge>off</Badge>}
              </div>
              <div className="truncate text-xs text-ink-faint">{p.url}</div>
            </div>
            <button
              onClick={() => toggle.mutate(p)}
              className="text-xs font-medium text-brand hover:underline"
            >
              {p.enabled ? "Disable" : "Enable"}
            </button>
            <button
              onClick={() => remove.mutate(p.id)}
              title="Remove"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 sm:flex-row">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Portal name (e.g. Dice)"
          className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="h-9 flex-[1.5] rounded-lg border border-border bg-surface px-3 text-sm"
        />
        <Button
          size="sm"
          onClick={() => add.mutate()}
          disabled={!label || !url || add.isPending}
        >
          <Plus size={16} /> Add
        </Button>
      </div>
    </Card>
  );
}
