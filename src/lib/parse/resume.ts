/**
 * Deterministic, structure-aware resume parser.
 *
 * Runs with NO external API. It segments the document into sections, then
 * extracts experience (with date ranges + bullets), skills (from an explicit
 * skills section AND a vocab scan over the whole doc), education, and contact
 * info. This is the fallback the app always relies on when the LLM is disabled,
 * so it has to be genuinely useful — not a 6-keyword stub.
 */
import { VOCAB } from "@/lib/matching/vocab";
import { canonical } from "@/lib/matching/synonyms";
import type { ExtractedProfile } from "@/lib/schemas/profile";
import type { RoleEntry, EducationEntry } from "@/lib/types";

type Section =
  | "summary"
  | "experience"
  | "skills"
  | "education"
  | "certifications"
  | "projects"
  | "other";

const SECTION_PATTERNS: { section: Section; re: RegExp }[] = [
  { section: "summary", re: /^(professional\s+)?(summary|profile|objective|about(\s+me)?)\b/i },
  { section: "experience", re: /^(work\s+|professional\s+|relevant\s+)?(experience|employment(\s+history)?|work\s+history|career\s+history)\b/i },
  { section: "skills", re: /^(technical\s+|core\s+|key\s+)?(skills|competenc(?:y|ies)|technologies|tech\s+stack|expertise|proficiencies)\b/i },
  { section: "education", re: /^(education|academic(\s+background)?|qualifications)\b/i },
  { section: "certifications", re: /^(certifications?|certificates?|licen[cs]es?|accreditations?)\b/i },
  { section: "projects", re: /^(projects?|selected\s+projects|notable\s+projects)\b/i },
];

const MONTHS =
  "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
// e.g. "Jan 2020 - Present", "2019 – 2022", "03/2018 - 06/2021"
const DATE_RANGE_RE = new RegExp(
  `(${MONTHS}\\s*)?(\\d{1,2}[\\/.-])?(\\d{4})\\s*(?:[–—\\-]+|\\bto\\b|\\buntil\\b)\\s*((${MONTHS}\\s*)?(\\d{1,2}[\\/.-])?\\d{4}|present|current|now|ongoing|till\\s+date|to\\s+date)`,
  "i"
);

const TITLE_HINT =
  /\b(engineer|developer|programmer|manager|designer|analyst|scientist|architect|consultant|lead|specialist|administrator|director|intern|officer|coordinator|strategist|devops|sre|qa|sde)\b/i;

const DEGREE_HINT =
  /\b(bachelor|master|ph\.?d|doctorate|b\.?s\.?c?|m\.?s\.?c?|b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|bsc|msc|mba|bba|associate|diploma|degree|b\.?a\.?|m\.?a\.?)\b/i;

const BULLET_RE = /^\s*([•·▪◦‣*\-–—]|•|\d+\.)\s+/;

export function parseResume(rawText: string): ExtractedProfile {
  const allLines = rawText.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const lines = allLines.map((l) => l.trim());

  // --- split into sections -------------------------------------------------
  const buckets: Record<Section, string[]> = {
    summary: [], experience: [], skills: [], education: [],
    certifications: [], projects: [], other: [],
  };
  const header: string[] = []; // lines before the first recognized section
  let current: Section | null = null;

  for (const line of lines) {
    if (!line) {
      if (current) buckets[current].push("");
      continue;
    }
    const matched = matchSectionHeader(line);
    if (matched) {
      current = matched;
      continue;
    }
    if (current) buckets[current].push(line);
    else header.push(line);
  }

  // --- contact / identity --------------------------------------------------
  const email = rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "";
  const phone =
    rawText.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim().replace(/\s{2,}/g, " ") ?? "";

  const fullName = detectName(header);
  const summary = cleanSummary(buckets.summary.join(" ").trim());

  // --- experience ----------------------------------------------------------
  const roles = parseExperience(buckets.experience);
  const title = detectTitle(header, roles);

  // --- skills --------------------------------------------------------------
  const { skills, tools } = parseSkills(buckets.skills, rawText);

  // --- education + certs ---------------------------------------------------
  const education = parseEducation(buckets.education);
  const certifications = buckets.certifications
    .map((l) => l.replace(BULLET_RE, "").trim())
    .filter((l) => l.length > 2 && l.length < 160);

  // --- domains (vocab category=domain + a few known industries) ------------
  const domains = parseDomains(rawText);

  // --- years of experience -------------------------------------------------
  const yearsExperience = computeYears(rawText, roles);

  return {
    fullName,
    title,
    email,
    phone,
    summary,
    yearsExperience,
    skills,
    tools,
    domains,
    roles,
    education,
    certifications,
  };
}

function matchSectionHeader(line: string): Section | null {
  // Headers are short. Strip trailing colon and decorative chars.
  const stripped = line.replace(/[:|_=–—-]+$/g, "").trim();
  if (stripped.length > 40 || stripped.split(/\s+/).length > 5) return null;
  for (const { section, re } of SECTION_PATTERNS) {
    if (re.test(stripped)) return section;
  }
  return null;
}

function detectName(header: string[]): string {
  for (const line of header) {
    if (!line) continue;
    if (/@|\d|http|www\./i.test(line)) continue; // contact line, not a name
    if (matchSectionHeader(line)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 1 && words.length <= 5 && line.length <= 50) {
      // reject lines that are obviously a title
      if (TITLE_HINT.test(line) && words.length > 1) continue;
      return line.slice(0, 60);
    }
  }
  return "";
}

function detectTitle(header: string[], roles: RoleEntry[]): string {
  // Prefer a title-looking line in the header block (just under the name).
  for (const line of header) {
    if (line && TITLE_HINT.test(line) && line.length <= 60 && !/@|http/i.test(line)) {
      return line.replace(/\s*[|•·].*$/, "").trim().slice(0, 80);
    }
  }
  return roles[0]?.title ?? "";
}

function cleanSummary(s: string): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim().slice(0, 600);
}

/** Group experience lines into roles using date-range lines as anchors. */
function parseExperience(secLines: string[]): RoleEntry[] {
  const roles: RoleEntry[] = [];
  // collapse blank-padded section into entries
  let i = 0;
  let pending: { header: string; date: RegExpMatchArray | null } | null = null;
  let bullets: string[] = [];

  const flush = () => {
    if (!pending) return;
    const { title, company } = splitTitleCompany(pending.header);
    const { startDate, endDate, years } = parseDateRange(pending.date);
    if (title || company) {
      roles.push({
        title,
        company,
        years,
        startDate,
        endDate,
        description: bullets.join("\n").trim() || undefined,
      });
    }
    pending = null;
    bullets = [];
  };

  for (; i < secLines.length; i++) {
    const line = secLines[i];
    if (!line) continue;
    const dateMatch = line.match(DATE_RANGE_RE);

    if (dateMatch) {
      // A new entry. Header text = this line minus dates, or the previous
      // non-bullet line if this line is only a date.
      flush();
      let headerText = line.replace(DATE_RANGE_RE, "").replace(/[|•·,–—-]\s*$/, "").trim();
      if (!headerText || headerText.length < 3) {
        // date-only line: use previous collected bullet/title if it wasn't a bullet
        const prev = secLines[i - 1]?.trim();
        if (prev && !BULLET_RE.test(prev)) headerText = prev;
      }
      pending = { header: headerText, date: dateMatch };
      continue;
    }

    if (BULLET_RE.test(line)) {
      if (pending) bullets.push(line.replace(BULLET_RE, "").trim());
      continue;
    }

    // Non-bullet, non-date line.
    if (!pending) {
      // Might be a title/company header whose date is on the NEXT line —
      // peek ahead.
      const next = secLines[i + 1]?.trim();
      if (next && DATE_RANGE_RE.test(next)) {
        pending = { header: line, date: next.match(DATE_RANGE_RE) };
        i++; // consume the date line
        continue;
      }
      // Otherwise a header with no detectable date (still a role).
      if (TITLE_HINT.test(line) || /\bat\b|@|\||,/.test(line)) {
        pending = { header: line, date: null };
      }
      continue;
    }
    // Inside an entry, plain line. If the NEXT line is a date range, this line
    // is actually the next role's header (title\ndate layout) — start it.
    const next = secLines[i + 1]?.trim();
    if (next && DATE_RANGE_RE.test(next)) {
      flush();
      pending = { header: line, date: next.match(DATE_RANGE_RE) };
      i++; // consume the date line
      continue;
    }
    // otherwise a continued description line
    bullets.push(line);
  }
  flush();
  return roles.slice(0, 15);
}

function splitTitleCompany(headerText: string): { title: string; company: string } {
  const h = headerText.replace(/\s{2,}/g, " ").trim();
  if (!h) return { title: "", company: "" };
  // "Senior Engineer at Acme", "Engineer | Acme", "Engineer — Acme", "Engineer, Acme"
  const atMatch = h.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
  if (atMatch) return { title: clip(atMatch[1]), company: clip(atMatch[2]) };
  const parts = h.split(/\s*[|•·–—,]\s*/).filter(Boolean);
  if (parts.length >= 2) {
    // title usually carries the role hint
    if (TITLE_HINT.test(parts[1]) && !TITLE_HINT.test(parts[0])) {
      return { title: clip(parts[1]), company: clip(parts[0]) };
    }
    return { title: clip(parts[0]), company: clip(parts[1]) };
  }
  // single token — decide by hint
  return TITLE_HINT.test(h) ? { title: clip(h), company: "" } : { title: "", company: clip(h) };
}

const clip = (s: string) => s.trim().replace(/^[|•·–—,\s]+|[|•·–—,\s]+$/g, "").slice(0, 80);

function parseDateRange(m: RegExpMatchArray | null): {
  startDate: string;
  endDate: string;
  years: number;
} {
  if (!m) return { startDate: "", endDate: "", years: 0 };
  const full = m[0];
  const yearMatches = full.match(/\d{4}/g) ?? [];
  const startYear = yearMatches[0] ? Number(yearMatches[0]) : 0;
  const endsNow = /present|current|now|ongoing|date/i.test(full);
  const endYear = endsNow
    ? new Date().getFullYear()
    : yearMatches[1]
    ? Number(yearMatches[1])
    : startYear;
  const years =
    startYear && endYear >= startYear ? Math.max(0, endYear - startYear) : 0;
  const startDate = yearMatches[0] ?? "";
  const endDate = endsNow ? "Present" : yearMatches[1] ?? startDate;
  return { startDate, endDate, years: Math.min(years, 50) };
}

/** Skills from an explicit section + a vocab scan over the full document. */
function parseSkills(secLines: string[], rawText: string): { skills: string[]; tools: string[] } {
  const skillSet = new Map<string, string>(); // canonical -> display
  const toolSet = new Map<string, string>();

  const vocabByCanon = new Map(VOCAB.map((v) => [canonical(v.name), v]));

  const add = (raw: string) => {
    const display = raw.trim().replace(/\.$/, "").trim();
    if (!display) return;
    const canon = canonical(display);
    const known = vocabByCanon.get(canon);
    if (known) {
      (known.category === "tool" ? toolSet : skillSet).set(canon, known.name);
    } else {
      // accept from explicit skills section only (avoid noise from prose scan)
      skillSet.set(canon, display);
    }
  };

  // 1) explicit skills section — split on common delimiters
  for (const line of secLines) {
    if (!line) continue;
    // drop a leading "Category:" label like "Languages: ..."
    const body = line.replace(/^[^:]{1,28}:\s*/, "").replace(BULLET_RE, "");
    for (const piece of body.split(/[,;|/•·\t]|\s{2,}/)) {
      const item = piece.trim();
      if (item.length < 1 || item.length > 40) continue;
      // skip sentence-like fragments
      if (item.split(/\s+/).length > 4) continue;
      if (/^(and|with|using|including|etc|various)$/i.test(item)) continue;
      add(item);
    }
  }

  // 2) vocab scan over the whole document (catches skills only mentioned in
  //    experience bullets, not in a skills section)
  const lower = rawText.toLowerCase();
  for (const v of VOCAB) {
    const needle = v.name.toLowerCase();
    const re = new RegExp(`(^|[^a-z0-9+#.])${escapeRe(needle)}([^a-z0-9+#.]|$)`, "i");
    if (re.test(lower)) {
      const canon = canonical(v.name);
      (v.category === "tool" ? toolSet : skillSet).set(canon, v.name);
    }
  }

  return {
    skills: Array.from(skillSet.values()).slice(0, 60),
    tools: Array.from(toolSet.values()).slice(0, 40),
  };
}

function parseEducation(secLines: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  for (const line of secLines) {
    const l = line.replace(BULLET_RE, "").trim();
    if (l.length < 4) continue;
    const yearMatch = l.match(/\b(19|20)\d{2}\b/);
    const hasDegree = DEGREE_HINT.test(l);
    if (!hasDegree && !/university|college|institute|school|academy/i.test(l)) continue;

    let degree = "";
    let field = "";
    let institution = "";

    const degreeMatch = l.match(
      /\b(ph\.?d|doctorate|master(?:'?s)?|bachelor(?:'?s)?|m\.?tech|b\.?tech|m\.?sc|b\.?sc|mba|bba|m\.?s\.?|b\.?s\.?|m\.?a\.?|b\.?a\.?|associate|diploma)\b[^,|–—]*/i
    );
    if (degreeMatch) degree = clip(degreeMatch[0]);

    const inMatch = l.match(/\bin\s+([A-Z][^,|–—]+)/);
    if (inMatch) field = clip(inMatch[1]);

    const instMatch = l.match(/([A-Z][\w.&'\- ]*(university|college|institute|school|academy)[\w.&'\- ]*)/i);
    if (instMatch) institution = clip(instMatch[1]);
    else {
      // fall back: the part after a comma/pipe that isn't the degree
      const parts = l.split(/\s*[,|–—]\s*/).map(clip).filter(Boolean);
      institution = parts.find((p) => p !== degree && !/in\s+/i.test(p)) ?? "";
    }

    out.push({ degree, field, institution, year: yearMatch?.[0] ?? "" });
  }
  return out.slice(0, 6);
}

function parseDomains(rawText: string): string[] {
  const set = new Set<string>();
  for (const v of VOCAB) {
    if (v.category === "domain" && rawText.toLowerCase().includes(v.name.toLowerCase())) {
      set.add(v.name);
    }
  }
  const INDUSTRIES = [
    "fintech", "healthcare", "e-commerce", "ecommerce", "edtech", "saas",
    "logistics", "cybersecurity", "gaming", "ad tech", "insurtech", "banking",
  ];
  const lower = rawText.toLowerCase();
  for (const d of INDUSTRIES) {
    if (lower.includes(d)) set.add(d === "ecommerce" ? "e-commerce" : d);
  }
  return Array.from(set).slice(0, 12);
}

function computeYears(rawText: string, roles: RoleEntry[]): number {
  const explicit = rawText.toLowerCase().match(/(\d{1,2})\+?\s*years?(?:\s+of)?\s+(?:experience|exp)/);
  if (explicit) return Math.min(Number(explicit[1]), 60);

  // span from earliest start to latest end across roles
  const starts = roles.map((r) => Number(r.startDate)).filter((n) => n >= 1950);
  if (starts.length) {
    const earliest = Math.min(...starts);
    const ends = roles.map((r) =>
      r.endDate && /^\d{4}$/.test(r.endDate) ? Number(r.endDate) : new Date().getFullYear()
    );
    const latest = Math.max(...ends);
    return Math.min(Math.max(0, latest - earliest), 60);
  }
  // fallback: sum of role years
  const sum = roles.reduce((a, r) => a + (r.years || 0), 0);
  return Math.min(sum, 60);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
