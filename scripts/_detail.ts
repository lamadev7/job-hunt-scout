import { getPage, closeBrowser } from "@/lib/portals/browser";
const URL = process.argv[2] || "https://weworkremotely.com/remote-jobs/bright-vision-technologies-site-reliability-engineer-sre";
(async () => {
  const page = await getPage("d");
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("err", e.message));
  for (let i = 0; i < 8; i++) {
    const title = await page.title().catch(() => "");
    const len = await page.evaluate(() => (document.body.innerText || "").length).catch(() => 0);
    console.log(`t=${i * 2}s title="${title}" bodyLen=${len}`);
    if (!/just a moment|checking your browser|verifying/i.test(title) && len > 1000) break;
    await page.waitForTimeout(2000);
  }
  await closeBrowser();
  process.exit(0);
})();
