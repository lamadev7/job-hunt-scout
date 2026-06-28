import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveProfile, rowToStructured } from "@/lib/profile";
import { recommendRoles } from "@/lib/profile-eval";

export const runtime = "nodejs";

/**
 * GET — recommended job titles for the active profile (deterministic, instant)
 * plus the user's currently-selected search titles. The agent run panel renders
 * `recommended` as add-able chips and `selected` as the active list.
 */
export async function GET() {
  const row = await getActiveProfile();
  if (!row) return NextResponse.json({ recommended: [], selected: [] });
  const profile = rowToStructured(row);
  const recommended = recommendRoles(profile);
  const selected = Array.isArray(row.targetRoles) && (row.targetRoles as string[]).length
    ? (row.targetRoles as string[])
    : recommended.map((r) => r.title);
  return NextResponse.json({ recommended, selected });
}

const postSchema = z.object({ roles: z.array(z.string().min(1).max(80)).max(8) });

/** POST — persist the user's chosen search titles (dedupe, trim). First becomes
 *  the default targetRole. Empty list resets to nothing selected. */
export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid roles." }, { status: 400 });
  const row = await getActiveProfile();
  if (!row) return NextResponse.json({ error: "No active profile." }, { status: 404 });

  const roles = Array.from(new Set(parsed.data.roles.map((r) => r.trim()).filter(Boolean)));
  await prisma.profile.update({
    where: { id: row.id },
    data: { targetRoles: roles, ...(roles[0] ? { targetRole: roles[0] } : {}) },
  });
  return NextResponse.json({ selected: roles });
}
