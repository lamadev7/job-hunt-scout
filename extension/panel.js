const $ = (id) => document.getElementById(id);

function toast(msg, err) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  setTimeout(() => t.classList.add("hidden"), 3200);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Inject content.js (idempotent), then call a helper defined there.
async function runHelper(tabId, fnName, arg) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (name, a) => window[name](a),
    args: [fnName, arg ?? null],
  });
  return result;
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

// ---- Settings -----------------------------------------------------------
chrome.storage.sync.get("apiBase").then(({ apiBase }) => {
  $("apiBase").value = apiBase || "http://localhost:3000";
});
$("settingsBtn").onclick = () => $("settings").classList.toggle("hidden");
$("saveSettings").onclick = async () => {
  await chrome.storage.sync.set({ apiBase: $("apiBase").value.trim().replace(/\/$/, "") });
  $("settings").classList.add("hidden");
  toast("Saved.");
};

// ---- Score --------------------------------------------------------------
$("scoreBtn").onclick = async () => {
  const btn = $("scoreBtn");
  btn.disabled = true;
  btn.textContent = "Reading page…";
  try {
    const tab = await activeTab();
    const page = await runHelper(tab.id, "__jobpilotExtractJD");
    if (!page || !page.jd || page.jd.length < 80) {
      toast("Couldn't find a job description on this page.", true);
      return;
    }
    $("scoreMeta").textContent = `Read ${page.jd.length} chars · ${page.position || "job"}`;
    $("scoreMeta").classList.remove("hidden");
    btn.textContent = "Scoring…";
    const res = await send({ type: "score", jd: page.jd, position: page.position, company: page.company });
    if (!res?.ok) {
      toast(res?.error || "Score failed.", true);
      return;
    }
    renderScore(res.data);
  } catch (e) {
    toast(String(e.message || e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Score this job";
  }
};

function chip(text) {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}

function renderScore(d) {
  $("scoreResult").classList.remove("hidden");
  $("matchPct").textContent = `${d.matchPct}%`;
  $("ringArc").style.strokeDashoffset = String(214 - (214 * d.matchPct) / 100);
  $("fitScore").textContent = d.fitScore;
  $("matchedCount").textContent = (d.matchedTerms || []).length;

  // Verdict + hard blockers (LLM-scored runs only).
  const v = $("verdict");
  if (d.verdict) { v.textContent = d.verdict; v.classList.remove("hidden"); }
  else v.classList.add("hidden");
  const bg = $("blockersGroup"); const b = $("blockers"); b.innerHTML = "";
  if (d.blockers && d.blockers.length) {
    d.blockers.forEach((t) => { const li = document.createElement("li"); li.textContent = t; b.appendChild(li); });
    bg.classList.remove("hidden");
  } else bg.classList.add("hidden");

  const m = $("matched"); m.innerHTML = "";
  (d.matchedTerms || []).forEach((t) => m.appendChild(chip(t)));
  if (!d.matchedTerms?.length) m.appendChild(chip("none yet"));
  const g = $("missing"); g.innerHTML = "";
  (d.missingTerms || []).forEach((t) => g.appendChild(chip(t)));
  if (!d.missingTerms?.length) g.appendChild(chip("no gaps 🎉"));
  const s = $("suggestions"); s.innerHTML = "";
  (d.suggestions || []).forEach((t) => {
    const li = document.createElement("li"); li.textContent = t; s.appendChild(li);
  });
}

// ---- Profile -> autofill fields ----------------------------------------
function cleanName(raw) {
  if (!raw) return "";
  let s = String(raw).split("/")[0]; // drop trailing "/ OVERVIEW" etc.
  // collapse letter-spaced runs: "P A R B A T" -> "PARBAT"
  s = s.replace(/\b(?:[A-Za-z]\s){2,}[A-Za-z]\b/g, (m) => m.replace(/\s+/g, ""));
  return s.replace(/[.\-]+/g, " ").replace(/\s+/g, " ").trim();
}

$("loadProfile").onclick = async () => {
  const res = await send({ type: "profile" });
  if (!res?.ok) { toast(res?.error || "Couldn't load profile.", true); return; }
  const p = res.data.profile;
  if (!p) { toast("No profile in the app yet — upload a resume.", true); return; }
  const name = cleanName(p.fullName);
  const [first, ...rest] = name.split(" ");
  $("f_firstName").value = first || "";
  $("f_lastName").value = rest.join(" ");
  $("f_email").value = p.email || "";
  $("f_phone").value = p.phone || "";
  $("f_title").value = p.title || "";
  $("f_years").value = p.yearsExperience ? String(p.yearsExperience) : "";
  toast("Loaded. Fix anything off before autofilling.");
};

$("fillBtn").onclick = async () => {
  const first = $("f_firstName").value.trim();
  const last = $("f_lastName").value.trim();
  const fields = {
    firstName: first,
    lastName: last,
    fullName: [first, last].filter(Boolean).join(" "),
    email: $("f_email").value.trim(),
    phone: $("f_phone").value.trim(),
    location: $("f_location").value.trim(),
    linkedin: $("f_linkedin").value.trim(),
    github: $("f_github").value.trim(),
    website: $("f_website").value.trim(),
    title: $("f_title").value.trim(),
    years: $("f_years").value.trim(),
  };
  try {
    const tab = await activeTab();
    const r = await runHelper(tab.id, "__jobpilotAutofill", fields);
    const el = $("fillResult");
    el.classList.remove("hidden");
    el.textContent = r?.count
      ? `Filled ${r.count} field(s): ${r.filled.map((f) => f.intent).join(", ")}. Review + submit yourself.`
      : "No matching empty fields found on this page.";
  } catch (e) {
    toast(String(e.message || e), true);
  }
};
