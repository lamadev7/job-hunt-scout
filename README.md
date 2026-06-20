# Job Apply Scout

An AI job-hunt agent that reads your resume, scans real job portals in a live browser, and ranks every posting against your skills with **deterministic, traceable matching** — so you get a focused shortlist instead of a wall of listings. It finds and scores jobs; it never auto-applies on your behalf.

---

## The Problem

Job hunting is mostly grunt work:

- **Manual scanning.** You open LinkedIn / Indeed, scroll endless Remote listings, and reread the same boilerplate JDs.
- **Fuzzy self-assessment.** "Am I a fit?" is a gut call. A JD says `REST`, your resume says `REST APIs`, and you can't tell at a glance whether you cover it.
- **No gap insight.** When you're *not* a fit, nothing tells you *which* skill is missing or what to learn next.
- **Black-box match scores.** Tools that slap an AI "match %" on a job rarely explain it — the number isn't reproducible or trustworthy.

## The Solution

Job Apply Scout automates the search and makes the matching **provable**:

- **Smart resume parsing** — extracts your profile (skills, experience with dates + bullets, education) from a PDF. Three tiers, best-first: Anthropic API → local Claude CLI → a structure-aware deterministic parser. It always works, even with zero API setup.
- **Real-browser scraping** — drives a headed Chromium (Playwright) to search Remote jobs on **LinkedIn** and **Indeed** within a time window you choose (24h / 2d / 7d / 30d / custom), reading each full job description.
- **Deterministic skill matching** — every match % comes from set intersection, not an LLM guess, so it's reproducible and explainable. Understands English phrasing too: `REST APIs` covers `REST`, `Node.js development` covers `Node.js`, etc.
- **Gap guidance** — for each job it shows the skills you're missing and turns them into concrete "add this" suggestions, plus a learning-milestone view.
- **Shortlist mode** — matches above your threshold are saved to history with full breakdowns. The agent does **not** submit applications.

## Tools & Technology

| Area | Stack |
|------|-------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Data | Prisma ORM + SQLite (local-first) |
| Browser automation | Playwright (Chromium, headed) |
| AI (optional) | Anthropic Claude — API key **or** the local Claude Code CLI |
| Resume parsing | `pdf-parse` + a deterministic section/skills parser |
| State / data fetching | TanStack Query, Zustand |
| Validation | Zod |
| Charts | Recharts |

> Portals with a registered adapter (LinkedIn, Indeed) run in a real browser automatically — **no environment variables required**. Any other portal you add falls back to mock demo data.

---

## Prerequisites

- **Node.js 20.9+** (the repo pins **22.x** via `.nvmrc` — `nvm use` to match)
- **pnpm** (`npm i -g pnpm`)
- **Chromium for Playwright** (installed in the steps below)
- *Optional:* an **Anthropic API key**, or the **Claude Code CLI** installed locally, for higher-quality resume extraction. Without either, the deterministic parser is used.

## Installation

```bash
# 1. Clone
git clone git@github.com:lamadev7/Job-Apply-Scout.git
cd Job-Apply-Scout

# 2. Use the pinned Node version
nvm use            # or ensure Node >= 20.9

# 3. Install dependencies (runs `prisma generate` automatically)
pnpm install

# 4. Install the Playwright browser
npx playwright install chromium

# 5. Configure environment (optional — copy and edit)
cp .env.example .env

# 6. Create the local SQLite database
pnpm db:push

# 7. Start the app
pnpm dev
```

Open <http://localhost:3000>.

### Useful scripts

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm db:push` | Apply the Prisma schema to SQLite |
| `pnpm db:studio` | Browse the database (Prisma Studio) |
| `pnpm db:reset` | Clear personal data (profile, applications, milestones) — keeps the job pool |

### Environment variables (all optional)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Use the Claude API for resume extraction. Empty = fall back to CLI, then heuristic. |
| `ANTHROPIC_MODEL` | Claude model (default `claude-sonnet-4-6`). |
| `CLAUDE_CLI_PATH` | Path to the `claude` CLI. Empty = auto-detect (PATH or `~/.claude/local/claude`). |
| `PORTAL_HEADLESS` | `1` hides the automation browser (not recommended — you can't solve CAPTCHAs). |

---

## User Manual

### 1. Add your resume
Go to **My Details** → drag in a PDF. The app parses it into a structured profile (skills, tools, experience with dates and bullets, education). Review the extracted fields, correct anything, and **Save & confirm** so the agent matches against accurate data.

### 2. Set up portals
On **My Details**, manage the job portals you want to target. LinkedIn and Indeed run in a real browser; any other portal you add uses mock demo data.

### 3. Connect a real portal (first run only)
In the **Run the Agent** panel, each real portal shows a **Connect** button. Click it to open the headed browser, sign in (and clear any verification/CAPTCHA), then click **Re-check**. The session is remembered for future runs.

### 4. Run the agent
In the same panel:
- Pick **portals** (or *All*).
- Optionally set a **target role** (pre-filled from your resume).
- Choose **Posted within**: 24 hours, 2 days, 7 days, 30 days, or a custom date.
- Set the **match threshold** — only jobs at/above it are saved.
- Click **Run Agent**. Selected portals are scanned at the same time, each in its own browser tab; matches stream in live.

### 5. Review results
Matches appear on the **Job hunts** page. Filter with the **All / Applied / Profile Matching** chips, search by company/role, and open any card to see the match breakdown — covered skills, missing skills, and suggestions to close the gap.

### 6. Improve & track
The **Enhancer** turns recurring skill gaps into prioritized learning milestones. The **Dashboard** shows your search stats over time. Use **Clear history** on Job hunts to wipe saved results (your job pool and profile are kept).

---

## How matching stays honest

Match percentages are computed from set intersection between your profile's skills and the skills extracted from each job description — both normalized through the same vocabulary and alias rules. The LLM (when available) only helps *read* the resume; it never invents the numbers. That makes every score reproducible and explainable.

## Notes & limitations

- **Anti-bot:** Indeed sits behind Cloudflare. The headed browser lets you clear challenges, but heavy automation can still be throttled — that's inherent to scraping these sites.
- **Local-first:** your resume, scraped jobs, and history live in a local SQLite file. Nothing is uploaded except (optionally) resume text sent to the Claude API for parsing.
- **Shortlist only:** the agent finds, reads, and scores jobs. It does not submit applications.
