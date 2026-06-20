// Injected into the active tab on demand. Defines two helpers in the isolated
// world; the side panel calls them via chrome.scripting and reads the return.
// Guarded so repeat injection is a no-op.

if (!window.__jobpilot) {
  window.__jobpilot = true;

  // ---- JD extraction ----------------------------------------------------
  const JD_SELECTORS = [
    "#job-details", ".jobs-description__content", ".jobs-box__html-content", // linkedin
    "#jobDescriptionText", // indeed
    "[data-automation-id='jobPostingDescription']", // workday
    "#content .body", "[class*='job'][class*='description']",
    "main article", "article", "main",
  ];

  function visibleText(el) {
    if (!el) return "";
    const t = (el.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return t;
  }

  window.__jobpilotExtractJD = function () {
    let jd = "";
    for (const sel of JD_SELECTORS) {
      const el = document.querySelector(sel);
      const t = visibleText(el);
      if (t && t.length > jd.length) jd = t;
      if (jd.length > 400) break;
    }
    // Fallback: the largest text block on the page.
    if (jd.length < 200) {
      let best = "";
      document.querySelectorAll("div,section,article,main").forEach((el) => {
        if (el.querySelector("nav,header,footer")) return;
        const t = visibleText(el);
        if (t.length > best.length && t.length < 12000) best = t;
      });
      if (best.length > jd.length) jd = best;
    }
    const h1 = document.querySelector("h1");
    return {
      jd: jd.slice(0, 12000),
      position: (h1 && h1.innerText.trim()) || document.title.split("|")[0].trim(),
      company: "",
      url: location.href,
      title: document.title,
    };
  };

  // ---- Autofill ---------------------------------------------------------
  // Intent detection from a field's label/name/id/placeholder/autocomplete.
  const RULES = [
    ["firstName", /(first[\s_-]?name|given[\s_-]?name|^fname)/i],
    ["lastName", /(last[\s_-]?name|surname|family[\s_-]?name|^lname)/i],
    ["fullName", /(full[\s_-]?name|^name$|your name|applicant name|legal name)/i],
    ["email", /e[\s_-]?mail/i],
    ["phone", /(phone|mobile|cell|contact number|tel)/i],
    ["linkedin", /linked[\s_-]?in/i],
    ["github", /git[\s_-]?hub/i],
    ["website", /(website|portfolio|personal site|url)/i],
    ["location", /(location|city|address|town|suburb)/i],
    ["years", /(years.{0,12}experience|experience.{0,6}years|yrs)/i],
    ["title", /(current.{0,4}(title|role|position)|job title|headline)/i],
    ["company", /(current.{0,4}(employer|company)|present employer)/i],
    ["coverLetter", /(cover letter|message|why.{0,20}(role|company|you)|additional information)/i],
  ];

  function intentOf(el) {
    const id = el.id;
    let label = "";
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l) label = l.innerText;
    }
    if (!label) {
      const wrap = el.closest("label");
      if (wrap) label = wrap.innerText;
    }
    const hay = [label, el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("autocomplete")]
      .filter(Boolean).join(" ");
    for (const [intent, re] of RULES) if (re.test(hay)) return intent;
    // autocomplete standard tokens
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac.includes("email")) return "email";
    if (ac.includes("tel")) return "phone";
    if (ac.includes("given-name")) return "firstName";
    if (ac.includes("family-name")) return "lastName";
    return null;
  }

  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  window.__jobpilotAutofill = function (fields) {
    const filled = [];
    const SKIP = new Set(["password", "hidden", "file", "submit", "button", "checkbox", "radio", "search"]);
    const controls = document.querySelectorAll("input, textarea");
    controls.forEach((el) => {
      if (el.tagName === "INPUT" && SKIP.has((el.type || "text").toLowerCase())) return;
      if (el.disabled || el.readOnly) return;
      if ((el.value || "").trim()) return; // never clobber existing input
      const intent = intentOf(el);
      if (!intent) return;
      const value = fields[intent];
      if (!value) return;
      setValue(el, value);
      el.style.outline = "2px solid #6366f1";
      filled.push({ intent, value: String(value).slice(0, 60) });
    });
    return { count: filled.length, filled };
  };
}
