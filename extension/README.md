# JobPilot Co-pilot (browser extension)

Scores the job page you're **already viewing** against your resume and autofills
the application form — all in your own logged-in browser session. No scraping,
no bot, no stored credentials, no ToS-violating automation. You click submit.

## How it works

```
Your tab (any job/apply page)
  ├─ content.js  extracts the JD text · fills empty form fields
  ├─ panel       Score this job → match% / gaps / suggestions · Autofill
  └─ background  proxies to the local JobPilot app (so no CORS)
        ↓
   Next app at http://localhost:3000
     /api/score    deterministic match scoring (same engine as the agent)
     /api/profile  your resume data for autofill
```

## Setup

1. Run the app: `pnpm dev` (needs Node ≥ 20 — `nvm use`). It must be reachable
   at `http://localhost:3000` (change in the panel ⚙ if you use another port).
2. Upload your resume in the app (My Details) so there's an active profile.
   - For best autofill quality, set `ANTHROPIC_API_KEY` in `.env` — the LLM
     parse is far cleaner than the heuristic fallback. You can also just fix the
     fields by hand in the panel before autofilling.
3. Load the extension:
   - Chrome → `chrome://extensions` → enable **Developer mode**
   - **Load unpacked** → select this `extension/` folder
4. Open any job posting → click the JobPilot toolbar icon to open the side panel.

## Use

- **Score this job** — reads the JD on the current tab, shows match %, matched
  skills, gaps, and improvement suggestions.
- **Load from app** — pulls your resume identity fields; edit anything off.
- **Autofill this page** — fills empty `name / email / phone / linkedin / github
  / location / title / years` fields it can identify. Highlights what it filled.
  **Review everything and submit yourself.**

## Notes / limits

- Autofill only touches **empty** fields and never submits.
- JD extraction is heuristic (known selectors + largest text block); odd layouts
  may need a manual copy-paste into the app instead.
- Multi-step wizards (Workday/CiAnywhere) fill the current step only.
