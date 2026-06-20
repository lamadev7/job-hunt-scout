// Service worker: opens the side panel and proxies API calls to the local
// JobPilot app. Running fetch here (with host_permissions) avoids CORS.

const DEFAULT_BASE = "http://localhost:3000";

async function apiBase() {
  const { apiBase } = await chrome.storage.sync.get("apiBase");
  return apiBase || DEFAULT_BASE;
}

// Click the toolbar icon -> open the side panel for that tab.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const base = await apiBase();
      if (msg.type === "score") {
        const res = await fetch(`${base}/api/score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jd: msg.jd, position: msg.position, company: msg.company }),
        });
        const data = await res.json();
        sendResponse(res.ok ? { ok: true, data } : { ok: false, error: data.error || "Score failed" });
      } else if (msg.type === "profile") {
        const res = await fetch(`${base}/api/profile`);
        const data = await res.json();
        sendResponse(res.ok ? { ok: true, data } : { ok: false, error: data.error || "Profile fetch failed" });
      } else {
        sendResponse({ ok: false, error: "Unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) + ` (is the app running at ${await apiBase()}?)` });
    }
  })();
  return true; // async response
});
