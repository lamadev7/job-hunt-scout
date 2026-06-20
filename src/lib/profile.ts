import { prisma } from "@/lib/db";
import { asArray } from "@/lib/utils";
import type { EducationEntry, RoleEntry, StructuredProfile } from "@/lib/types";

export type ProfileRow = NonNullable<
  Awaited<ReturnType<typeof prisma.profile.findFirst>>
>;

export function rowToStructured(row: ProfileRow): StructuredProfile {
  return {
    fullName: row.fullName,
    title: row.title,
    email: row.email,
    phone: row.phone,
    summary: row.summary,
    yearsExperience: row.yearsExperience,
    skills: asArray<string>(row.skills),
    tools: asArray<string>(row.tools),
    domains: asArray<string>(row.domains),
    roles: asArray<RoleEntry>(row.roles),
    education: asArray<EducationEntry>(row.education),
    certifications: asArray<string>(row.certifications),
    rawText: row.rawText,
    confidence: row.confidence,
    source: (row.source as "llm" | "heuristic" | "confirmed") ?? "heuristic",
  };
}

export async function getActiveProfile() {
  return prisma.profile.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
}
