import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({
  applyState: z.enum(["not_attempted", "queued"]).optional(),
});

/** PATCH /api/applications/:id — light state edits (e.g. Skip = un-queue). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update." }, { status: 400 });

  const exists = await prisma.application.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const app = await prisma.application.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ id: app.id, applyState: app.applyState });
}
