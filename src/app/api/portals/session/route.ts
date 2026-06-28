import { NextResponse } from "next/server";
import { z } from "zod";
import { getRealAdapter, isReal } from "@/lib/portals/registry";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/portals/session?portal=linkedin
 * Reports whether a portal runs for real and whether its session is logged in.
 */
export async function GET(req: Request) {
  const portal = new URL(req.url).searchParams.get("portal") ?? "linkedin";
  const adapter = getRealAdapter(portal);
  if (!adapter) {
    return NextResponse.json({ portal, real: false, loggedIn: false });
  }
  const real = isReal(); // every portal is browser-driven now
  let loggedIn = false;
  if (adapter.isLoggedIn) {
    try {
      loggedIn = await adapter.isLoggedIn();
    } catch {
      loggedIn = false;
    }
  }
  return NextResponse.json({ portal, real, loggedIn });
}

const body = z.object({ portal: z.string().default("linkedin") });

/**
 * POST /api/portals/session — open the headed login window for a portal.
 * Returns immediately; the user signs in at their own pace and the client
 * re-polls GET to detect success.
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });

  const adapter = getRealAdapter(parsed.data.portal);
  if (!adapter?.openLogin) {
    return NextResponse.json({ error: `No real adapter for "${parsed.data.portal}".` }, { status: 400 });
  }
  try {
    await adapter.openLogin();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to open login window.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
