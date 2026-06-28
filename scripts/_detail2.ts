import { getPage, closeBrowser } from "@/lib/portals/browser";
import { harvestJobLinks, scrapeDetail } from "@/lib/portals/scrape";
const BASE = process.argv[2] || "https://remoteok.com/";
const RE = process.argv[3] || "/remote-jobs/\\d+";
(async () => {
  const page = await getPage("d2");
  await page.goto(BASE, { waitUntil: "commit", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const links = await harvestJobLinks(page, RE, 5, 3);
  console.log("links matched:", links.length, links.slice(0, 3));
  if (links[0]) {
    await page.goto(links[0], { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const title = await page.title().catch(() => "");
    const d = await scrapeDetail(page, { title: "", company: "", jd: "", posted: "" });
    console.log(`detail "${links[0]}" title="${title}" jdLen=${d.jd.length} pos="${d.position.slice(0,40)}"`);
  }
  await closeBrowser();
  process.exit(0);
})();
