import { getPage, closeBrowser } from "@/lib/portals/browser";

// Probe what an arbitrary portal landing page exposes, and whether the CURRENT
// learner can find a job feed from it. No assumptions — observe the real DOM.
const BASE = process.argv[2] || "https://arc.dev/";

(async () => {
  const page = await getPage("probe");
  console.log("goto", BASE);
  await page.goto(BASE, { waitUntil: "commit", timeout: 45_000 }).catch((e) => console.log("goto err", e.message));
  await page.waitForTimeout(4000);
  console.log("landed at:", page.url());

  const snap = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({ href: (a as HTMLAnchorElement).href, text: ((a as HTMLElement).innerText || "").trim().slice(0, 40) }))
      .filter((a) => a.href);
    const navish = anchors.filter((a) => /job|career|position|opening|browse|find|search|hire/i.test(a.href + " " + a.text)).slice(0, 25);
    const inputs = Array.from(document.querySelectorAll("input,select")).slice(0, 25).map((el) => {
      const i = el as HTMLInputElement;
      return { name: i.getAttribute("name") || "", id: i.id || "", ph: i.getAttribute("placeholder") || "", type: i.getAttribute("type") || el.tagName.toLowerCase(), aria: i.getAttribute("aria-label") || "" };
    });
    return { total: anchors.length, navish, inputs };
  });
  console.log("total anchors:", snap.total);
  console.log("job/career-ish links:", JSON.stringify(snap.navish, null, 1));
  console.log("inputs:", JSON.stringify(snap.inputs, null, 1));

  await closeBrowser();
  process.exit(0);
})();
