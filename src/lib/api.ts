/** Tiny typed fetch helpers for client components. */
import type { RoleEntry, EducationEntry } from "@/lib/types";

export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `GET ${url} failed`);
  return res.json();
}

export async function sendJSON<T>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST"
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `${method} ${url} failed`);
  return res.json();
}

/* ---- client-facing shapes ---- */
export type ApplicationItem = {
  id: string;
  status: string;
  matchPct: number;
  fitScore: number;
  matchedTerms: string[];
  missingTerms: string[];
  suggestions: string[];
  appliedAt: string;
  applyState: string;
  applyError: string | null;
  screenshots: string[];
  attemptedAt: string | null;
  profileYears: number;
  job: {
    id: string;
    company: string;
    position: string;
    url: string | null;
    portal: string;
    location: string;
    seniority: string;
    remote: boolean;
    easyApply: boolean;
    yearsRequired: number;
    applicantCount: number;
    salaryMin: number | null;
    salaryMax: number | null;
    postedAt: string;
    jd: string;
    requiredSkills: string[];
    niceSkills: string[];
  };
};

export type PortalRow = {
  id: string;
  name: string;
  label: string;
  url: string;
  enabled: boolean;
};

export type ProfileResponse = {
  profile:
    | (Record<string, unknown> & {
        id: string;
        fullName: string;
        title: string;
        targetRole: string;
        email: string;
        phone: string;
        summary: string;
        yearsExperience: number;
        skills: string[];
        tools: string[];
        domains: string[];
        roles: RoleEntry[];
        education: EducationEntry[];
        certifications: string[];
        confidence: number;
        source: string;
        files: { id: string; name: string; path: string; size: number; pages: number }[];
      })
    | null;
  files: { id: string; name: string; path: string; size: number; pages: number }[];
};

export type MilestoneRow = {
  id: string;
  skill: string;
  category: string;
  priority: number;
  demandScore: number;
  frequency: number;
  rationale: string;
  done: boolean;
};

export type StrengthCardRow = { key: string; label: string; value: number; total: number; detail: string };
