/**
 * Pure-logic tests for the portal-recipe learner. No DB / browser / LLM.
 * Run: `node --import tsx src/lib/portals/recipe.test.ts`
 */
import assert from "node:assert/strict";
import {
  buildSearchUrl,
  coerceRecipeDraft,
  coerceRecipeDraftWithSteps,
  isValidRegex,
  jobLinkMatcher,
  sinceDays,
  substitute,
} from "./recipe";
import { firstJsonValue } from "@/lib/llm/cli";
import type { SearchQuery } from "./adapter";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const DAY = 86_400_000;
const q = (over: Partial<SearchQuery> = {}): SearchQuery => ({ portals: ["x"], ...over });

console.log("recipe pure logic");

test("isValidRegex accepts good, rejects poison", () => {
  assert.equal(isValidRegex("/jobs/\\d+"), true);
  assert.equal(isValidRegex("("), false); // unbalanced — would throw if used
});

test("sinceDays: missing -> 1, floors at 1, ceils partial days", () => {
  assert.equal(sinceDays(undefined), 1);
  assert.equal(sinceDays("not-a-date"), 1);
  assert.equal(sinceDays(new Date(Date.now() - 0).toISOString()), 1);
  assert.equal(sinceDays(new Date(Date.now() - 3 * DAY).toISOString()), 3);
  assert.equal(sinceDays(new Date(Date.now() - 1.2 * DAY).toISOString()), 2);
});

test("buildSearchUrl: empty template -> base url", () => {
  assert.equal(buildSearchUrl("", "https://site.com/jobs", q()), "https://site.com/jobs");
  assert.equal(buildSearchUrl("   ", "https://site.com/jobs", q()), "https://site.com/jobs");
});

test("buildSearchUrl: substitutes + url-encodes all placeholders", () => {
  const url = buildSearchUrl(
    "https://s.com/search?q={role}&l={location}&d={sinceDays}&r={remote}",
    "https://s.com",
    q({ role: "Full Stack Engineer", location: "New York", remoteOnly: true, since: new Date(Date.now() - 2 * DAY).toISOString() })
  );
  assert.equal(url, "https://s.com/search?q=Full%20Stack%20Engineer&l=New%20York&d=2&r=1");
});

test("buildSearchUrl: remoteOnly with no location defaults location to Remote", () => {
  const url = buildSearchUrl("https://s.com?l={location}&r={remote}", "https://s.com", q({ remoteOnly: true }));
  assert.equal(url, "https://s.com?l=Remote&r=1");
});

test("buildSearchUrl: not-remote leaves remote blank and location empty", () => {
  const url = buildSearchUrl("https://s.com?l={location}&r={remote}", "https://s.com", q({ remoteOnly: false }));
  assert.equal(url, "https://s.com?l=&r=");
});

test("coerceRecipeDraft: fills defaults, keeps required regex", () => {
  const d = coerceRecipeDraft({ jobLinkRegex: "/viewjob" });
  assert.ok(d);
  assert.equal(d!.jobLinkRegex, "/viewjob");
  assert.equal(d!.searchUrlTemplate, "");
  assert.equal(d!.titleSelector, "");
  assert.equal(d!.confidence, 0.5);
});

test("coerceRecipeDraft: rejects missing regex", () => {
  assert.equal(coerceRecipeDraft({ titleSelector: "h1" }), null);
  assert.equal(coerceRecipeDraft({ jobLinkRegex: "" }), null);
});

test("coerceRecipeDraft: rejects a regex that won't compile", () => {
  assert.equal(coerceRecipeDraft({ jobLinkRegex: "(" }), null);
});

test("coerceRecipeDraft: rejects non-objects", () => {
  assert.equal(coerceRecipeDraft(null), null);
  assert.equal(coerceRecipeDraft("nope"), null);
  assert.equal(coerceRecipeDraft(42), null);
});

test("coerceRecipeDraft: clamps confidence out of range", () => {
  assert.equal(coerceRecipeDraft({ jobLinkRegex: "/x", confidence: 5 }), null); // zod max(1) rejects
});

test("jobLinkMatcher: case-insensitive, matches detail links only", () => {
  const re = jobLinkMatcher({ jobLinkRegex: "/jobs/view/\\d+" });
  assert.equal(re.test("https://X.com/JOBS/VIEW/12345"), true);
  assert.equal(re.test("https://x.com/jobs/search?q=eng"), false);
});

test("substitute: fills url placeholders (encoded) from query", () => {
  const out = substitute("https://x.com/jobs?term={role}&loc={location}&d={sinceDays}&r={remote}", q({ role: "Staff Engineer", remoteOnly: true, since: new Date(Date.now() - 3 * DAY).toISOString() }), true);
  assert.match(out, /term=Staff%20Engineer/);
  assert.match(out, /loc=Remote/); // remoteOnly defaults location to Remote
  assert.match(out, /r=1/);
  assert.match(out, /d=[34]/); // ceil(3 days), tolerant of timing
});

test("substitute: fill values are NOT url-encoded (typed raw into inputs)", () => {
  assert.equal(substitute("{role}", q({ role: "C++ Dev" }), false), "C++ Dev");
  assert.equal(substitute("{role}", q({ role: "C++ Dev" }), true), "C%2B%2B%20Dev");
});

test("coerceRecipeDraftWithSteps: keeps valid steps, drops malformed ones", () => {
  const d = coerceRecipeDraftWithSteps({
    jobLinkRegex: "/jobs/\\d+",
    steps: [
      { action: "goto", url: "https://x.com/jobs?q={role}" },
      { action: "fill", selector: "#kw", value: "{role}" },
      { action: "bogus", foo: 1 }, // dropped
      { action: "click" }, // missing selector — dropped
      { action: "press", key: "Enter" },
    ],
  });
  assert.ok(d);
  assert.equal(d!.steps.length, 3); // goto, fill, press survive
  assert.equal(d!.steps[0].action, "goto");
});

test("coerceRecipeDraftWithSteps: still requires a compilable regex", () => {
  assert.equal(coerceRecipeDraftWithSteps({ jobLinkRegex: "(", steps: [] }), null);
  assert.equal(coerceRecipeDraftWithSteps({ steps: [] }), null); // missing regex
});

test("coerceRecipeDraftWithSteps: empty steps is allowed (legacy template path)", () => {
  const d = coerceRecipeDraftWithSteps({ jobLinkRegex: "/jobs/\\d+", searchUrlTemplate: "https://x.com?q={role}" });
  assert.ok(d);
  assert.equal(d!.steps.length, 0);
});

test("firstJsonValue: extracts the object even with trailing prose", () => {
  const v = firstJsonValue('Here is the recipe:\n{"matchPct": 42, "blockers": []}\nThat caps it at <=30.') as Record<string, unknown>;
  assert.equal(v.matchPct, 42);
});

test("firstJsonValue: ignores braces inside strings", () => {
  const v = firstJsonValue('{"note": "use {role} here", "n": 1}') as Record<string, unknown>;
  assert.equal(v.n, 1);
  assert.equal(v.note, "use {role} here");
});

test("firstJsonValue: skips a leading non-JSON brace-ish token, finds the real object", () => {
  const v = firstJsonValue("not json { oops } then {\"ok\": true}") as Record<string, unknown>;
  assert.equal(v.ok, true);
});

test("firstJsonValue: returns null when nothing parses", () => {
  assert.equal(firstJsonValue("no json here at all"), null);
});

console.log(`\n${passed} passed`);
