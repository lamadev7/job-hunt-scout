import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiExtractionAvailable } from "@/lib/llm/client";
import { evaluateTargetRole } from "@/lib/profile-eval";
import { asArray } from "@/lib/utils";
import { roleSchema, educationSchema } from "@/lib/schemas/profile";
import type { RoleEntry } from "@/lib/types";

export const runtime = "nodejs";

/** GET — LLM availability + whether a profile exists (lightweight status). */
export async function GET() {
  const profile = await prisma.profile.findFirst({ where: { isActive: true } });
  return NextResponse.json({ llmEnabled: await aiExtractionAvailable(), hasProfile: !!profile });
}

const patchSchema = z.object({
  fullName: z.string().max(120).optional(),
  title: z.string().max(120).optional(),
  email: z.string().max(160).optional(),
  phone: z.string().max(60).optional(),
  summary: z.string().max(2000).optional(),
  yearsExperience: z.number().min(0).max(60).optional(),
  skills: z.array(z.string().min(1).max(60)).max(80).optional(),
  tools: z.array(z.string().min(1).max(60)).max(80).optional(),
  domains: z.array(z.string().min(1).max(60)).max(80).optional(),
  roles: z.array(roleSchema).max(30).optional(),
  education: z.array(educationSchema).max(15).optional(),
});

/** PATCH — user corrections to the extracted profile. Marks it user-confirmed. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid profile update." }, { status: 400 });
  }

  const active = await prisma.profile.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!active) {
    return NextResponse.json({ error: "No active profile to update." }, { status: 404 });
  }

  const data = parsed.data;
  const clean = <T extends string>(arr?: T[]) =>
    arr ? Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))) : undefined;

  // Re-evaluate the default target role from the corrected values.
  const targetRole = evaluateTargetRole({
    title: data.title ?? active.title,
    yearsExperience: data.yearsExperience ?? active.yearsExperience,
    skills: data.skills ? clean(data.skills)! : asArray<string>(active.skills),
    tools: data.tools ? clean(data.tools)! : asArray<string>(active.tools),
    roles: data.roles ?? asArray<RoleEntry>(active.roles),
  });

  const profile = await prisma.profile.update({
    where: { id: active.id },
    data: {
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      ...(data.title !== undefined && { title: data.title }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.summary !== undefined && { summary: data.summary }),
      ...(data.yearsExperience !== undefined && { yearsExperience: data.yearsExperience }),
      ...(data.skills && { skills: clean(data.skills) }),
      ...(data.tools && { tools: clean(data.tools) }),
      ...(data.domains && { domains: clean(data.domains) }),
      ...(data.roles && { roles: data.roles }),
      ...(data.education && { education: data.education }),
      targetRole,
      // any manual correction promotes confidence + marks the source as confirmed
      confidence: 1,
      source: "confirmed",
    },
    include: { files: true },
  });

  return NextResponse.json({ profile });
}
