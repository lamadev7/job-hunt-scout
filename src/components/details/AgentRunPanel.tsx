"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Sparkles, Loader2, CheckCircle2, Briefcase, LogIn, AlertTriangle, MapPin, ExternalLink, X } from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { getJSON, sendJSON, type PortalRow } from "@/lib/api";
import { cn } from "@/lib/utils";

type MatchEvent = { company: string; position: string; postedAt: string; matchPct: number; url: string | null };
type Summary = {
  evaluated: number;
  matched: number;
  skipped: number;
  topMatches: { company: string; position: string; matchPct: number }[];
  errors: string[];
};
type AgentEvent =
  | { type: "status"; message: string }
  | { type: "match"; match: MatchEvent }
  | { type: "skip"; position: string; matchPct: number }
  | { type: "done"; summary: Summary }
  | { type: "error"; message: string };

type SessionStatus = { portal: string; real: boolean; loggedIn: boolean };

type PostedWindow = "24h" | "2d" | "7d" | "30d" | "custom";
const POSTED_WINDOWS: { key: PostedWindow; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "2d", label: "2 days" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "custom", label: "Custom date" },
];

function postedLabel(iso: string): string {
  try {
    return `${formatDistanceToNow(new Date(iso))} ago`;
  } catch {
    return "recently";
  }
}

export function AgentRunPanel({ hasProfile, defaultRole }: { hasProfile: boolean; defaultRole?: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["portals"],
    queryFn: () => getJSON<{ portals: PortalRow[] }>("/api/portals"),
  });
  const portals = (data?.portals ?? []).filter((p) => p.enabled);

  const [selected, setSelected] = useState<string[]>([]);

  // Recommended search titles (from the profile) + the user's chosen set. The
  // agent searches EACH chosen title and dedupes — "Full Stack" isn't the only
  // way to describe this person; Frontend / Backend / Mobile may fit too.
  const { data: rolesData } = useQuery({
    queryKey: ["profile-roles"],
    queryFn: () => getJSON<{ recommended: { title: string; family: string; reason: string }[]; selected: string[] }>("/api/profile/roles"),
    enabled: hasProfile,
  });
  const [titles, setTitles] = useState<string[]>(defaultRole ? [defaultRole] : []);
  const [titleInput, setTitleInput] = useState("");
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !rolesData) return;
    const seed = rolesData.selected?.length ? rolesData.selected : rolesData.recommended.map((r) => r.title);
    if (seed.length) { setTitles(seed); seededRef.current = true; }
  }, [rolesData]);

  const addTitle = (t: string) => {
    const v = t.trim();
    if (!v) return;
    setTitles((cur) => (cur.some((x) => x.toLowerCase() === v.toLowerCase()) ? cur : [...cur, v]));
  };
  const removeTitle = (t: string) => setTitles((cur) => cur.filter((x) => x !== t));
  const recommendedToAdd = (rolesData?.recommended ?? []).filter(
    (r) => !titles.some((t) => t.toLowerCase() === r.title.toLowerCase())
  );

  const [threshold, setThreshold] = useState(90);
  const [postedWithin, setPostedWithin] = useState<PostedWindow>("24h");
  const [customDate, setCustomDate] = useState("");

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [matches, setMatches] = useState<MatchEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const skippedRef = useRef(0);

  const allSelected = selected.length === 0; // empty = all

  // Real portals in the current selection each need a one-time browser connect
  // (sign in / pass any bot check). Mock portals self-hide their gate.
  const effectivePortals = allSelected ? portals : portals.filter((p) => selected.includes(p.name));

  function handleEvent(e: AgentEvent) {
    if (e.type === "status") setStatus(e.message);
    else if (e.type === "skip") skippedRef.current += 1;
    else if (e.type === "match") setMatches((cur) => [e.match, ...cur]);
    else if (e.type === "error") toast.error(e.message);
    else if (e.type === "done") {
      const s = e.summary;
      setSummary(s);
      setStatus("");
      if (s.matched > 0) {
        toast.success(`Saved ${s.matched} match${s.matched === 1 ? "" : "es"} to History.`);
      } else if (s.evaluated > 0) {
        toast.info(`Scanned ${s.evaluated} job${s.evaluated === 1 ? "" : "s"} — none reached ${threshold}% match.`);
      } else if (s.errors.length > 0) {
        toast.error(s.errors[0]);
      } else {
        toast.info("No jobs found to scan. Connect your portals (or check your sign-in) and try again.");
      }
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["milestones"] });
      qc.invalidateQueries({ queryKey: ["strength"] });
      qc.invalidateQueries({ queryKey: ["portal-session"] });
    }
  }

  async function startRun() {
    if (running) return;
    setRunning(true);
    setSummary(null);
    setMatches([]);
    skippedRef.current = 0;
    setStatus("Starting…");
    // Remember the chosen titles for next time (fire-and-forget).
    if (titles.length) sendJSON("/api/profile/roles", { roles: titles }).catch(() => {});
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portals: selected,
          roles: titles.length ? titles : undefined,
          threshold,
          postedWithin,
          since: postedWithin === "custom" && customDate ? new Date(customDate).toISOString() : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Agent run failed to start.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) {
            try {
              handleEvent(JSON.parse(line) as AgentEvent);
            } catch {
              /* ignore malformed line */
            }
          }
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
      setStatus("");
    } finally {
      setRunning(false);
    }
  }

  const togglePortal = (name: string) =>
    setSelected((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles size={16} className="text-brand" /> Run the Agent
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        Opens the portal, signs in if needed, scans <b>Remote</b> jobs posted in the <b>last 24h</b>, reads each
        description, matches it to your resume, and saves the matches to History. It does <b>not</b> apply.
      </p>

      {effectivePortals.map((p) => (
        <PortalGate key={p.id} name={p.name} label={p.label} />
      ))}

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-ink-soft">Portals</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelected([])}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              allSelected ? "border-brand bg-brand text-white" : "border-border bg-surface text-ink-soft hover:bg-surface-2"
            )}
          >
            All
          </button>
          {portals.map((p) => {
            const on = selected.includes(p.name);
            return (
              <button
                key={p.id}
                onClick={() => togglePortal(p.name)}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                  on ? "border-brand bg-brand text-white" : "border-border bg-surface text-ink-soft hover:bg-surface-2"
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-ink-soft">
          Target roles <span className="text-ink-faint">(searches each; recommended from your résumé)</span>
        </div>
        {/* chosen titles */}
        <div className="flex flex-wrap gap-2">
          {titles.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand px-2 py-1 text-xs font-medium text-white">
              {t}
              <button onClick={() => removeTitle(t)} className="opacity-80 hover:opacity-100" title="Remove" aria-label={`Remove ${t}`}>
                <X size={11} />
              </button>
            </span>
          ))}
          {titles.length === 0 && <span className="text-xs text-ink-faint">Add at least one title (or it searches broadly).</span>}
        </div>

        {/* add custom */}
        <div className="mt-2 flex gap-2">
          <input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTitle(titleInput); setTitleInput(""); } }}
            placeholder="Add a title, e.g. Backend Engineer"
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm"
          />
          <Button variant="outline" className="h-9 px-3 text-xs" onClick={() => { addTitle(titleInput); setTitleInput(""); }} disabled={!titleInput.trim()}>
            Add
          </Button>
        </div>

        {/* recommended to add */}
        {recommendedToAdd.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-[11px] font-medium text-ink-faint">Recommended for you</div>
            <div className="flex flex-wrap gap-2">
              {recommendedToAdd.map((r) => (
                <button
                  key={r.title}
                  onClick={() => addTitle(r.title)}
                  title={r.reason}
                  className="rounded-full border border-dashed border-border bg-surface px-3 py-1 text-xs text-ink-soft transition-colors hover:border-brand hover:text-brand"
                >
                  + {r.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-ink-soft">
          <span>Match threshold (save above)</span>
          <span className="text-brand">{threshold}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full accent-[var(--color-brand)]"
        />
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-ink-soft">Posted within</div>
        <div className="flex flex-wrap gap-2">
          {POSTED_WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setPostedWithin(w.key)}
              className={cn(
                "rounded-full border px-2 py-1 text-xs font-medium transition-colors",
                postedWithin === w.key ? "border-brand bg-brand text-white" : "border-border bg-surface text-ink-soft hover:bg-surface-2"
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        {postedWithin === "custom" && (
          <div className="mt-2">
            <input
              type="date"
              value={customDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setCustomDate(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface px-3 text-sm"
            />
            <p className="mt-1 text-[11px] text-ink-faint">Jobs posted on or after this date.</p>
          </div>
        )}
      </div>

      {/* ---- live progress (above the button) ---- */}
      {(running || matches.length > 0 || summary) && (
        <div className="mt-4 rounded-xl border border-border bg-surface-2/40 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
              {running ? <Loader2 size={14} className="animate-spin text-brand" /> : <CheckCircle2 size={14} className="text-success" />}
              Matches
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">{matches.length}</span>
            </div>
            {(running || summary) && (
              <span className="text-[11px] text-ink-faint">
                {summary ? `${summary.evaluated} read · ${summary.skipped} below bar` : `${skippedRef.current} below bar`}
              </span>
            )}
          </div>

          {running && status && (
            <div className="mt-2 truncate text-[11px] text-ink-faint">{status}</div>
          )}

          {matches.length > 0 ? (
            <div className="mt-3 space-y-2">
              {matches.map((m, i) => (
                <div key={`${m.url ?? m.position}-${i}`} className="rounded-lg border border-border bg-surface p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {m.url ? (
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-center gap-1 truncate text-sm font-medium text-brand hover:underline"
                          title="Open job post in a new tab"
                        >
                          <span className="truncate">{m.position}</span>
                          <ExternalLink size={12} className="shrink-0 opacity-70 group-hover:opacity-100" />
                        </a>
                      ) : (
                        <div className="truncate text-sm font-medium">{m.position}</div>
                      )}
                      <div className="truncate text-xs text-ink-soft">{m.company}</div>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
                        <MapPin size={11} /> {postedLabel(m.postedAt)}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
                      {m.matchPct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !running && summary && (
              <div className="mt-2 text-xs text-ink-faint">No matches ≥ {threshold}% this run. Try lowering the threshold.</div>
            )
          )}

          {summary?.errors?.length ? (
            <div className="mt-3 space-y-1 border-t border-border pt-2">
              {summary.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-warn">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{e}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <Button className="mt-4 w-full" onClick={startRun} disabled={!hasProfile || running || (postedWithin === "custom" && !customDate)}>
        {running ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
        {running ? "Agent working…" : "Run Agent"}
      </Button>
      {!hasProfile && (
        <p className="mt-2 text-center text-xs text-warn">Upload a resume first to enable the agent.</p>
      )}
    </Card>
  );
}

/**
 * Per-portal connect/re-check gate. Self-hides for mock portals (real=false).
 * For real portals it shows a "connected" banner once the browser session is
 * live, or a Connect/Re-check prompt to open the headed window (sign in / pass
 * any bot check) before running.
 */
function PortalGate({ name, label }: { name: string; label: string }) {
  const session = useQuery({
    queryKey: ["portal-session", name],
    queryFn: () => getJSON<SessionStatus>(`/api/portals/session?portal=${encodeURIComponent(name)}`),
    refetchOnWindowFocus: true,
  });
  const connect = useMutation({
    mutationFn: () => sendJSON<{ ok: boolean }>("/api/portals/session", { portal: name }),
    onSuccess: () => toast.success(`Login window opened for ${label} — sign in / pass any check, then Re-check.`),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!session.data?.real) return null;

  if (session.data.loggedIn) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-2.5 text-xs text-success">
        <CheckCircle2 size={14} /> {label} connected — agent will use your live session.
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-warn/30 bg-warn/5 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-ink-soft">
        <Briefcase size={14} className="shrink-0 text-brand" />
        <span className="truncate"><b className="font-medium text-ink">{label}</b> — sign in once</span>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => connect.mutate()} disabled={connect.isPending} title={`Connect ${label}`}>
          {connect.isPending ? <Loader2 className="animate-spin" size={13} /> : <LogIn size={13} />}
          Connect
        </Button>
        <Button variant="outline" className="h-7 w-7 px-0 text-xs" onClick={() => session.refetch()} disabled={session.isFetching} title="Re-check">
          {session.isFetching ? <Loader2 className="animate-spin" size={13} /> : <span className="text-sm">↻</span>}
        </Button>
      </div>
    </div>
  );
}
