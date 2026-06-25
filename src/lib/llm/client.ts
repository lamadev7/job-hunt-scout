import Anthropic from "@anthropic-ai/sdk";
import { extractedProfileSchema, type ExtractedProfile } from "@/lib/schemas/profile";
import { parseResume } from "@/lib/parse/resume";
import { extractViaCli, cliAvailable } from "@/lib/llm/cli";
import type { StructuredProfile } from "@/lib/types";

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

export const llmEnabled = Boolean(apiKey);

const client = llmEnabled ? new Anthropic({ apiKey }) : null;

/** True when extraction can use an LLM — via API key OR the local Claude CLI. */
export async function aiExtractionAvailable(): Promise<boolean> {
  return llmEnabled || (await cliAvailable());
}

const EXTRACT_INSTRUCTIONS =
  "You are an expert resume parser. Use ONLY facts present in the text — do not invent skills, employers, dates, or numbers.\n" +
  "Be thorough:\n" +
  "- Capture EVERY work-experience entry in `roles` (title, company, start/end dates, years, and a description with the key bullet points).\n" +
  "- Put concrete technical skills/languages/frameworks in `skills`, platforms/infra/tools in `tools`, industries in `domains`.\n" +
  "- Scan the whole document for skills, not just a 'Skills' section — pull tech mentioned inside experience bullets too.\n" +
  "- Compute `yearsExperience` from the span of the work history (use today's date for 'Present').\n" +
  "If a field is genuinely absent, leave it empty.";

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "save_profile",
  description: "Save the structured resume profile extracted ONLY from the provided text.",
  input_schema: {
    type: "object",
    properties: {
      fullName: { type: "string" },
      title: { type: "string", description: "Current/most recent job title" },
      email: { type: "string" },
      phone: { type: "string" },
      summary: { type: "string", description: "2-3 sentence professional summary" },
      yearsExperience: { type: "number", description: "Total years of professional experience" },
      skills: { type: "array", items: { type: "string" }, description: "Hard technical skills, languages, frameworks" },
      tools: { type: "array", items: { type: "string" }, description: "Tools, platforms, infra" },
      domains: { type: "array", items: { type: "string" }, description: "Industry/domains e.g. fintech, healthcare" },
      roles: {
        type: "array",
        description: "Every work-experience entry, most recent first.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Job title" },
            company: { type: "string", description: "Employer name" },
            years: { type: "number", description: "Duration in years (end minus start; use today for 'Present')" },
            startDate: { type: "string", description: "Start, e.g. 'Jan 2020' or '2020'" },
            endDate: { type: "string", description: "End, e.g. 'Mar 2023' or 'Present'" },
            description: { type: "string", description: "Key responsibilities/achievements as newline-separated bullets" },
          },
          required: ["title", "company", "years"],
        },
      },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            degree: { type: "string" },
            field: { type: "string" },
            institution: { type: "string" },
            year: { type: "string" },
          },
          required: ["degree", "field", "institution"],
        },
      },
      certifications: { type: "array", items: { type: "string" } },
    },
    required: ["fullName", "title", "skills", "yearsExperience"],
  },
};

/**
 * Extract a structured profile from raw resume text. Three tiers, best first:
 *   1. Anthropic API (forced tool-use) when ANTHROPIC_API_KEY is set.
 *   2. Local Claude Code CLI (`claude -p`) when the binary is installed.
 *   3. Deterministic structure-aware parser (always works, no network).
 */
export async function extractProfile(rawText: string): Promise<StructuredProfile> {
  const viaApi = await extractViaApi(rawText);
  if (viaApi) return viaApi;

  const viaCli = await extractViaCliTier(rawText);
  if (viaCli) return viaCli;

  return heuristicExtract(rawText);
}

/** Tier 1 — Anthropic API with forced tool-use. */
async function extractViaApi(rawText: string): Promise<StructuredProfile | null> {
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0,
      tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
      tools: [EXTRACT_TOOL],
      messages: [
        {
          role: "user",
          content:
            EXTRACT_INSTRUCTIONS +
            "\nExtract the resume into the save_profile tool.\n\n=== RESUME TEXT ===\n" +
            rawText.slice(0, 48000),
        },
      ],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") {
      const parsed = extractedProfileSchema.safeParse(block.input);
      if (parsed.success) return finalize(parsed.data, rawText, "llm", 0.9);
    }
  } catch (err) {
    console.error("[llm] API extract failed, trying next tier:", err);
  }
  return null;
}

/** Tier 2 — local Claude CLI, asked to emit JSON matching the schema. */
async function extractViaCliTier(rawText: string): Promise<StructuredProfile | null> {
  const prompt =
    EXTRACT_INSTRUCTIONS +
    "\n\nReturn ONLY a single JSON object (no prose, no code fences) with EXACTLY these keys:\n" +
    `{"fullName":"","title":"","email":"","phone":"","summary":"","yearsExperience":0,` +
    `"skills":[],"tools":[],"domains":[],` +
    `"roles":[{"title":"","company":"","years":0,"startDate":"","endDate":"","description":""}],` +
    `"education":[{"degree":"","field":"","institution":"","year":""}],"certifications":[]}\n\n` +
    "=== RESUME TEXT ===\n" +
    rawText.slice(0, 48000);

  const raw = await extractViaCli(prompt);
  if (!raw) return null;
  const parsed = extractedProfileSchema.safeParse(raw);
  if (parsed.success) return finalize(parsed.data, rawText, "llm", 0.85);
  console.error("[cli] extract output failed schema validation, falling back to heuristic");
  return null;
}

/**
 * Deterministic fallback: a structure-aware parser (sections, date ranges,
 * skill lists, experience bullets, education). Used whenever the LLM is off.
 */
export function heuristicExtract(rawText: string): StructuredProfile {
  const extracted = parseResume(rawText);

  // confidence reflects how much real structure we recovered
  const signals =
    (extracted.skills.length + extracted.tools.length >= 4 ? 1 : 0) +
    (extracted.roles.length >= 1 ? 1 : 0) +
    (extracted.education.length >= 1 ? 1 : 0) +
    (extracted.fullName ? 1 : 0);
  const confidence = Math.min(0.4 + signals * 0.12, 0.8);

  return finalize(extracted, rawText, "heuristic", confidence);
}

function finalize(
  e: ExtractedProfile,
  rawText: string,
  source: "llm" | "heuristic",
  confidence: number
): StructuredProfile {
  return {
    fullName: e.fullName,
    title: e.title,
    email: e.email,
    phone: e.phone,
    summary: e.summary,
    yearsExperience: e.yearsExperience,
    skills: e.skills,
    tools: e.tools,
    domains: e.domains,
    roles: e.roles,
    education: e.education,
    certifications: e.certifications,
    rawText,
    confidence,
    source,
  };
}

/**
 * Generic "return JSON" call used by the portal-recipe learner. Same two-tier
 * strategy as extraction (Anthropic API, then local Claude CLI). Returns the
 * first parsed JSON value, or null if no LLM is available / it produced nothing
 * parseable. Never throws.
 */
export async function askJson(prompt: string, maxTokens = 1500): Promise<unknown | null> {
  if (client) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = res.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        const m = textBlock.text.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
      }
    } catch (err) {
      console.error("[llm] askJson API failed, trying CLI:", err);
    }
  }
  // Tier 2 — local Claude CLI (extractViaCli already extracts the first JSON object).
  return extractViaCli(prompt);
}

/**
 * Turn a list of missing skills into short, grounded improvement suggestions.
 * LLM only does the WORDING; the skill list itself is computed by the matcher.
 */
export async function wordSuggestions(missing: string[], position: string): Promise<string[]> {
  const top = missing.slice(0, 4);
  if (top.length === 0) return [];
  if (client) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 400,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content:
              `For a "${position}" role, write one short resume-improvement tip per missing skill. ` +
              `Return ONLY a JSON array of strings, same length/order as input. Missing skills: ${JSON.stringify(top)}`,
          },
        ],
      });
      const textBlock = res.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        const arr = JSON.parse(textBlock.text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
        if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) return arr;
      }
    } catch (err) {
      console.error("[llm] wordSuggestions failed, using template:", err);
    }
  }
  return top.map((s) => `Add hands-on ${s} experience (a project or bullet) to strengthen this match.`);
}
