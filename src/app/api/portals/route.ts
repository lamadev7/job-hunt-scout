import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ensureDefaultPortals } from "@/lib/portals/bootstrap";

export const runtime = "nodejs";

export async function GET() {
  await ensureDefaultPortals();
  const portals = await prisma.portal.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ portals });
}

const createSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid portal payload." }, { status: 400 });
  }
  const { label, url, enabled } = parsed.data;
  const name =
    parsed.data.name ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  try {
    const portal = await prisma.portal.create({
      data: { name, label, url, enabled: enabled ?? true },
    });
    return NextResponse.json({ portal });
  } catch {
    return NextResponse.json({ error: "Portal already exists." }, { status: 409 });
  }
}
