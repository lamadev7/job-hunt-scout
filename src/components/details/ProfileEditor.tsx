"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Bot, Pencil, Check, X, AlertTriangle, Loader2, Briefcase, GraduationCap, Plus, Trash2 } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui/primitives";
import { TagInput } from "@/components/ui/TagInput";
import { toast } from "@/components/ui/toast";
import { sendJSON } from "@/lib/api";
import type { RoleEntry, EducationEntry } from "@/lib/types";

type Profile = {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  summary: string;
  yearsExperience: number;
  skills: string[];
  tools: string[];
  domains: string[];
  roles: RoleEntry[];
  education: EducationEntry[];
  confidence: number;
  source: string;
};

type Draft = Pick<
  Profile,
  "fullName" | "title" | "email" | "phone" | "summary" | "yearsExperience" | "skills" | "tools" | "domains" | "roles" | "education"
>;

export function ProfileEditor({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));

  const needsReview = profile.source !== "confirmed";
  const roles = profile.roles ?? [];
  const education = profile.education ?? [];

  const save = useMutation({
    mutationFn: () => sendJSON("/api/profile", draft, "PATCH"),
    onSuccess: () => {
      toast.success("Profile confirmed. The agent will use these details.");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["strength"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = () => {
    setDraft(toDraft(profile));
    setEditing(true);
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const sourceBadge =
    profile.source === "confirmed" ? (
      <Badge tone="success"><BadgeCheck size={12} /> confirmed</Badge>
    ) : profile.source === "llm" ? (
      <Badge tone="brand"><Bot size={12} /> AI parsed</Badge>
    ) : (
      <Badge tone="neutral">heuristic</Badge>
    );

  return (
    <Card className="p-5 animate-fade-up">
      {needsReview && !editing && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-xs text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Review extracted details.</span> Auto-extraction can miss or
            misread items. Confirm so the agent matches against accurate data.
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Field label="Full name">
                <input value={draft.fullName} onChange={(e) => patch({ fullName: e.target.value })} className={INPUT} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Title">
                  <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} className={INPUT} />
                </Field>
                <Field label="Years experience">
                  <input
                    type="number"
                    min={0}
                    value={draft.yearsExperience}
                    onChange={(e) => patch({ yearsExperience: Number(e.target.value) })}
                    className={INPUT}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Email">
                  <input value={draft.email} onChange={(e) => patch({ email: e.target.value })} className={INPUT} />
                </Field>
                <Field label="Phone">
                  <input value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} className={INPUT} />
                </Field>
              </div>
              <Field label="Summary">
                <textarea
                  value={draft.summary}
                  onChange={(e) => patch({ summary: e.target.value })}
                  rows={3}
                  className={`${INPUT} h-auto py-2 leading-relaxed`}
                />
              </Field>
            </div>
          ) : (
            <>
              <div className="text-lg font-semibold">{profile.fullName || "Unnamed profile"}</div>
              <div className="text-sm text-ink-soft">{profile.title || "—"}</div>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex flex-col items-end gap-2">
            {sourceBadge}
            <Button size="sm" variant="ghost" onClick={startEdit}>
              <Pencil size={14} /> Edit
            </Button>
          </div>
        )}
      </div>

      {!editing && (
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-faint">
          <BadgeCheck size={14} className="text-success" />
          Confidence {Math.round(profile.confidence * 100)}% · {profile.yearsExperience} yrs exp
        </div>
      )}

      {!editing && profile.summary && (
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{profile.summary}</p>
      )}

      <EditableSection label="Skills" editing={editing} items={editing ? draft.skills : profile.skills} tone="brand" onChange={(v) => patch({ skills: v })} />
      <EditableSection label="Tools" editing={editing} items={editing ? draft.tools : profile.tools} tone="neutral" onChange={(v) => patch({ tools: v })} />
      <EditableSection label="Domains" editing={editing} items={editing ? draft.domains : profile.domains} tone="success" onChange={(v) => patch({ domains: v })} />

      <ExperienceSection
        editing={editing}
        roles={editing ? draft.roles : roles}
        onChange={(v) => patch({ roles: v })}
      />
      <EducationSection
        editing={editing}
        items={editing ? draft.education : education}
        onChange={(v) => patch({ education: v })}
      />

      {editing && (
        <div className="mt-5 flex gap-2">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save & confirm
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>
            <X size={14} /> Cancel
          </Button>
        </div>
      )}

      {!editing && profile.email && (
        <div className="mt-4 text-xs text-ink-faint">{profile.email}{profile.phone ? ` · ${profile.phone}` : ""}</div>
      )}
    </Card>
  );
}

const INPUT = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm";

function toDraft(p: Profile): Draft {
  return {
    fullName: p.fullName,
    title: p.title,
    email: p.email,
    phone: p.phone,
    summary: p.summary ?? "",
    yearsExperience: p.yearsExperience,
    skills: [...p.skills],
    tools: [...p.tools],
    domains: [...p.domains],
    roles: (p.roles ?? []).map((r) => ({ ...r })),
    education: (p.education ?? []).map((e) => ({ ...e })),
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function EditableSection({
  label,
  items,
  editing,
  tone,
  onChange,
}: {
  label: string;
  items: string[];
  editing: boolean;
  tone: "brand" | "neutral" | "success";
  onChange: (v: string[]) => void;
}) {
  if (!editing && !items?.length) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 text-xs font-medium text-ink-soft">{label}</div>
      {editing ? (
        <TagInput value={items} onChange={onChange} tone={tone} placeholder={`Add ${label.toLowerCase()}…`} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((s) => (
            <Badge key={s} tone={tone}>{s}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const dateLabel = (r: RoleEntry) =>
  [r.startDate, r.endDate].filter(Boolean).join(" – ") || (r.years ? `${r.years} yr` : "");

function ExperienceSection({
  roles,
  editing,
  onChange,
}: {
  roles: RoleEntry[];
  editing: boolean;
  onChange: (v: RoleEntry[]) => void;
}) {
  if (!editing && !roles?.length) return null;

  const update = (i: number, p: Partial<RoleEntry>) =>
    onChange(roles.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const remove = (i: number) => onChange(roles.filter((_, idx) => idx !== i));
  const add = () => onChange([...roles, { title: "", company: "", years: 0, startDate: "", endDate: "", description: "" }]);

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-soft">
        <Briefcase size={13} /> Experience
      </div>

      {editing ? (
        <div className="space-y-3">
          {roles.map((r, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface-2/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={r.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Title" className={INPUT} />
                <input value={r.company} onChange={(e) => update(i, { company: e.target.value })} placeholder="Company" className={INPUT} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <input value={r.startDate ?? ""} onChange={(e) => update(i, { startDate: e.target.value })} placeholder="Start" className={INPUT} />
                <input value={r.endDate ?? ""} onChange={(e) => update(i, { endDate: e.target.value })} placeholder="End" className={INPUT} />
                <input type="number" min={0} value={r.years} onChange={(e) => update(i, { years: Number(e.target.value) })} placeholder="Years" className={INPUT} />
              </div>
              <textarea
                value={r.description ?? ""}
                onChange={(e) => update(i, { description: e.target.value })}
                rows={3}
                placeholder="Key responsibilities / achievements"
                className={`${INPUT} mt-2 h-auto py-2 leading-relaxed`}
              />
              <button onClick={() => remove(i)} className="mt-2 flex items-center gap-1 text-xs text-danger hover:underline">
                <Trash2 size={12} /> Remove
              </button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={add}>
            <Plus size={14} /> Add experience
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map((r, i) => (
            <div key={i} className="border-l-2 border-border pl-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-medium">{r.title || "—"}</div>
                <div className="shrink-0 text-xs text-ink-faint">{dateLabel(r)}</div>
              </div>
              {r.company && <div className="text-xs text-ink-soft">{r.company}</div>}
              {r.description && (
                <ul className="mt-1 space-y-0.5">
                  {r.description.split("\n").filter(Boolean).slice(0, 6).map((b, bi) => (
                    <li key={bi} className="text-xs leading-relaxed text-ink-soft">• {b.replace(/^[•\-*]\s*/, "")}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EducationSection({
  items,
  editing,
  onChange,
}: {
  items: EducationEntry[];
  editing: boolean;
  onChange: (v: EducationEntry[]) => void;
}) {
  if (!editing && !items?.length) return null;

  const update = (i: number, p: Partial<EducationEntry>) =>
    onChange(items.map((e, idx) => (idx === i ? { ...e, ...p } : e)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { degree: "", field: "", institution: "", year: "" }]);

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-soft">
        <GraduationCap size={13} /> Education
      </div>
      {editing ? (
        <div className="space-y-3">
          {items.map((e, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface-2/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={e.degree} onChange={(ev) => update(i, { degree: ev.target.value })} placeholder="Degree" className={INPUT} />
                <input value={e.field} onChange={(ev) => update(i, { field: ev.target.value })} placeholder="Field" className={INPUT} />
              </div>
              <div className="mt-2 grid grid-cols-[2fr_1fr] gap-2">
                <input value={e.institution} onChange={(ev) => update(i, { institution: ev.target.value })} placeholder="Institution" className={INPUT} />
                <input value={e.year ?? ""} onChange={(ev) => update(i, { year: ev.target.value })} placeholder="Year" className={INPUT} />
              </div>
              <button onClick={() => remove(i)} className="mt-2 flex items-center gap-1 text-xs text-danger hover:underline">
                <Trash2 size={12} /> Remove
              </button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={add}>
            <Plus size={14} /> Add education
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((e, i) => (
            <div key={i} className="text-sm">
              <span className="font-medium">{[e.degree, e.field].filter(Boolean).join(", ") || "—"}</span>
              {e.institution && <span className="text-ink-soft"> · {e.institution}</span>}
              {e.year && <span className="text-ink-faint"> ({e.year})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
