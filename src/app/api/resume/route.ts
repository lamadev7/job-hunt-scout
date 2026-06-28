import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { parsePdf } from "@/lib/pdf";
import { extractProfile } from "@/lib/llm/client";
import { evaluateTargetRole, recommendRoles } from "@/lib/profile-eval";

export const runtime = "nodejs";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/** GET — active profile + uploaded files. */
export async function GET() {
  const profile = await prisma.profile.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    include: { files: { orderBy: { uploadedAt: "desc" } } },
  });
  const files = profile
    ? profile.files
    : await prisma.resumeFile.findMany({ orderBy: { uploadedAt: "desc" } });
  return NextResponse.json({ profile, files });
}

/** POST — upload one or more PDFs, parse, extract a structured profile. */
export async function POST(req: Request) {
  const form = await req.formData();
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);

  if (uploads.length === 0) {
    return NextResponse.json({ error: "No files provided." }, { status: 400 });
  }
  for (const f of uploads) {
    if (f.type && f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: `Only PDF files are supported (${f.name}).` }, { status: 400 });
    }
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const saved: { name: string; path: string; size: number; pages: number; text: string }[] = [];
  for (const file of uploads) {
    const buf = Buffer.from(await file.arrayBuffer());
    const safe = file.name.replace(/[^\w.-]+/g, "_");
    const fname = `${randomUUID()}-${safe}`;
    await writeFile(path.join(UPLOAD_DIR, fname), buf);
    let parsed = { text: "", pages: 0 };
    try {
      parsed = await parsePdf(buf);
    } catch (err) {
      console.error("[resume] pdf parse failed:", err);
    }
    saved.push({
      name: file.name,
      path: `/uploads/${fname}`,
      size: buf.length,
      pages: parsed.pages,
      text: parsed.text,
    });
  }

  const combinedText = saved.map((s) => s.text).join("\n\n").trim();
  const structured = await extractProfile(combinedText);

  // Recommend search titles from the parsed resume (skills, roles, years). The
  // first is the default target role; all seed the editable multi-title list.
  const recommended = recommendRoles(structured);
  const targetRoles = recommended.map((r) => r.title);
  const targetRole = targetRoles[0] ?? evaluateTargetRole(structured);

  // Deactivate previous profiles, create the new active one.
  await prisma.profile.updateMany({ data: { isActive: false }, where: { isActive: true } });
  const profile = await prisma.profile.create({
    data: {
      isActive: true,
      fullName: structured.fullName,
      title: structured.title,
      targetRole,
      targetRoles,
      email: structured.email,
      phone: structured.phone,
      summary: structured.summary,
      yearsExperience: structured.yearsExperience,
      skills: structured.skills,
      tools: structured.tools,
      domains: structured.domains,
      roles: structured.roles,
      education: structured.education,
      certifications: structured.certifications,
      rawText: structured.rawText,
      confidence: structured.confidence,
      source: structured.source,
      files: {
        create: saved.map((s) => ({
          name: s.name,
          path: s.path,
          size: s.size,
          pages: s.pages,
        })),
      },
    },
    include: { files: true },
  });

  return NextResponse.json({ profile });
}
