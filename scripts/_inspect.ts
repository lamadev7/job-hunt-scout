import { prisma } from "@/lib/db";
(async () => {
  const p = await prisma.portal.findMany();
  const r = await prisma.portalRecipe.findMany();
  console.log("PORTALS:", JSON.stringify(p.map((x) => ({ name: x.name, url: x.url, enabled: x.enabled })), null, 1));
  console.log("RECIPES:", r.length, JSON.stringify(r.map((x) => ({ portal: x.portal, tmpl: x.searchUrlTemplate, regex: x.jobLinkRegex, status: x.status })), null, 1));
  process.exit(0);
})();
