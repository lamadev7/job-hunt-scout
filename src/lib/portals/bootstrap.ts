import { prisma } from "@/lib/db";

/**
 * Integration config — NOT demo data. These are the job sources the agent can
 * scan. Only LinkedIn ships with a real adapter today (see registry.ts); it is
 * created on first read so the app is usable out of the box without any seed.
 * Idempotent: safe to call on every request and survives `db:reset`.
 */
export const DEFAULT_PORTALS = [
  { name: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/jobs", enabled: true },
];

let ensured = false;

export async function ensureDefaultPortals(): Promise<void> {
  if (ensured) return;
  if ((await prisma.portal.count()) === 0) {
    for (const p of DEFAULT_PORTALS) {
      await prisma.portal.upsert({
        where: { name: p.name },
        create: p,
        update: {},
      });
    }
  }
  ensured = true;
}
