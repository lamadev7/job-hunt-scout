import { VOCAB } from "./vocab";

/**
 * Real portals give us free-text job descriptions, not structured skill lists.
 * We derive required/nice skills deterministically by scanning the JD for known
 * vocab terms — the SAME vocabulary the resume parser uses, so scoring stays
 * apples-to-apples and provable. No LLM guessing of the skill list.
 *
 * "nice-to-have" terms are those that appear under a bonus/plus/preferred
 * heading; everything else detected is treated as required.
 */
// A REAL "nice to have" section heading — anchored to a line/bullet start so an
// inline word like "C# / .NET preferred" inside a Required-Skills list does NOT
// demote the rest of the JD to optional. Must look like a heading, optionally
// followed by a colon.
const NICE_HEADING =
  /(?:^|\n)\s*(?:[-*•]\s*)?(?:nice[\s-]?to[\s-]?haves?|bonus(?:\s+points)?|good[\s-]to[\s-]have|preferred\s+qualifications|preferred\s+skills|pluses)\s*:?/im;

export function extractJobSkills(jd: string): { required: string[]; nice: string[] } {
  const text = jd.toLowerCase();

  // Locate the start of a "nice to have" section, if any.
  const niceMatch = NICE_HEADING.exec(jd);
  const niceFrom = niceMatch ? niceMatch.index : Infinity;

  const required: string[] = [];
  const nice: string[] = [];

  for (const v of VOCAB) {
    const needle = v.name.toLowerCase();
    const idx = text.indexOf(needle);
    if (idx === -1) continue;
    // word-ish boundary check to avoid "go" matching "going", "java" matching "javascript"
    if (!isWholeTerm(text, idx, needle.length)) {
      // try a later, properly-bounded occurrence
      const bounded = findBounded(text, needle);
      if (bounded === -1) continue;
      (bounded >= niceFrom ? nice : required).push(v.name);
      continue;
    }
    (idx >= niceFrom ? nice : required).push(v.name);
  }

  // A term can't be both; required wins.
  const reqSet = new Set(required.map((s) => s.toLowerCase()));
  return { required, nice: nice.filter((s) => !reqSet.has(s.toLowerCase())) };
}

function isWholeTerm(text: string, idx: number, len: number): boolean {
  const before = idx === 0 ? " " : text[idx - 1];
  // "." counts as part of the token before (so "asp.net" doesn't yield "net"),
  const beforeOk = !/[a-z0-9.+#]/i.test(before);
  return beforeOk && afterIsBoundary(text, idx + len);
}

/**
 * Is the position after a term a word boundary? A "." only belongs to the term
 * when followed by another word char ("node.js", "asp.net") — a trailing dot
 * ("We use Kotlin.") is a boundary, so end-of-sentence skills still match.
 */
function afterIsBoundary(text: string, pos: number): boolean {
  if (pos >= text.length) return true;
  const c = text[pos];
  if (/[a-z0-9+#]/i.test(c)) return false;
  if (c === ".") {
    const next = text[pos + 1];
    return !next || !/[a-z0-9+#]/i.test(next);
  }
  return true;
}

function findBounded(text: string, needle: string): number {
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) return -1;
    if (isWholeTerm(text, idx, needle.length)) return idx;
    from = idx + needle.length;
  }
}
