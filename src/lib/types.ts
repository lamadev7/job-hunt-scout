/** Shared domain types used across server + client. */

export type RoleEntry = {
  title: string;
  company: string;
  years: number;
  startDate?: string;
  endDate?: string;
  description?: string;
};
export type EducationEntry = { degree: string; field: string; institution: string; year?: string };

export type StructuredProfile = {
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
  certifications: string[];
  rawText: string;
  confidence: number; // 0..1
  source: "llm" | "heuristic" | "confirmed";
};

export type MatchResult = {
  matchPct: number; // 0..100 — deterministic skill coverage
  fitScore: number; // 0..100 — composite shortlist estimate
  matchedTerms: string[];
  missingTerms: string[];
  // Experience criterion (null when the JD states no requirement). Kept separate
  // from missingTerms so it never leaks into skill-learning milestones.
  experience: { required: number; have: number; meets: boolean; fit: number } | null;
  breakdown: {
    mustHaveCoverage: number; // 0..1
    niceHaveCoverage: number; // 0..1
    yearsMatch: number; // 0..1
    applicantFactor: number; // 0..1 (fewer applicants = higher)
  };
};

export type DateRangeKey = "today" | "yesterday" | "week" | "month" | "custom";

export type DashboardStats = {
  totalApplied: number;
  totalMatched: number;
  avgMatchPct: number;
  avgFitScore: number;
  avgApplicants: number;
  topMissing: { term: string; count: number }[];
  byPortal: { portal: string; count: number }[];
  timeline: { date: string; applied: number; matched: number }[];
};
