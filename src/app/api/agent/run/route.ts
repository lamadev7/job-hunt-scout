import { z } from "zod";
import { runAgent, type AgentEvent } from "@/lib/agent/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300; // real runs open a browser + wait for sign-in

const schema = z.object({
  portals: z.array(z.string()).default([]),
  role: z.string().optional(),
  threshold: z.number().min(0).max(100).default(90),
  postedWithin: z.enum(["24h", "2d", "7d", "30d", "custom"]).default("24h"),
  since: z.string().optional(), // ISO; used when postedWithin === "custom"
});

/**
 * Streams newline-delimited JSON (NDJSON) agent events so the UI can show live
 * progress (status + each match) instead of waiting for one final response.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid run params." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client disconnected */
        }
      };
      try {
        await runAgent(parsed.data, send);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Agent run failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
