import { prisma } from "@/lib/db";

export type AppSettings = {
  autoApplyEnabled: boolean;
  dailyCap: number;
  dryRunFirst: boolean;
};

const DEFAULTS: AppSettings = { autoApplyEnabled: false, dailyCap: 10, dryRunFirst: true };

/** Read the singleton settings row, creating it with defaults on first access. */
export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.appSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...DEFAULTS },
    update: {},
  });
  return { autoApplyEnabled: row.autoApplyEnabled, dailyCap: row.dailyCap, dryRunFirst: row.dryRunFirst };
}

/** Count applications actually submitted today — used to enforce the daily cap. */
export async function submittedToday(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return prisma.application.count({
    where: { applyState: "submitted", attemptedAt: { gte: start } },
  });
}
