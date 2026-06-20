/**
 * Claude Code CLI fallback for resume extraction.
 *
 * When no ANTHROPIC_API_KEY is set, we can still get LLM-quality extraction by
 * shelling out to the locally-installed `claude` binary (uses the user's own
 * Claude Code auth — no key in .env needed). Runs headless print mode with
 * JSON output. Returns null on any failure so callers fall back to heuristics.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";

const pExecFile = promisify(execFile);

let resolved = false;
let binPath: string | null = null;

/**
 * Locate the CLI once (cached). Tries, in order: CLAUDE_CLI_PATH, `claude` on
 * PATH, then the common local-install location (~/.claude/local/claude). This
 * matters because the dev server may run under a different Node version than
 * the one whose bin dir holds `claude`.
 */
async function resolveCli(): Promise<string | null> {
  if (resolved) return binPath;
  resolved = true;
  const candidates = [
    process.env.CLAUDE_CLI_PATH?.trim(),
    "claude",
    path.join(homedir(), ".claude", "local", "claude"),
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    try {
      await pExecFile(candidate, ["--version"], { timeout: 10_000 });
      binPath = candidate;
      return binPath;
    } catch {
      /* try next candidate */
    }
  }
  binPath = null;
  return binPath;
}

export async function cliAvailable(): Promise<boolean> {
  return (await resolveCli()) !== null;
}

/**
 * Run `claude -p` with the given prompt and return the first JSON object found
 * in its result. Returns null if the CLI is missing, times out, or emits no
 * parseable JSON.
 */
export async function extractViaCli(prompt: string): Promise<unknown | null> {
  const bin = await resolveCli();
  if (!bin) return null;
  try {
    const { stdout } = await pExecFile(
      bin,
      ["-p", prompt, "--output-format", "json"],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }
    );
    // Print-mode JSON wrapper: { type, result, ... }. result holds the text.
    let text = stdout;
    try {
      const wrapper = JSON.parse(stdout);
      if (wrapper && typeof wrapper.result === "string") text = wrapper.result;
    } catch {
      /* not wrapped — use raw stdout */
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    console.error("[cli] extractViaCli failed:", err);
    return null;
  }
}
