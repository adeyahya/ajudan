import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Server-Sent Events stream of a business's activity feed.
 * The worker writes activity_events rows; this polls SQLite and forwards new rows.
 *
 *   event: activity   data: ActivityEvent
 *   event: ping       (keep-alive)
 *
 * Query: ?since=<event id> to resume; defaults to the latest id (only new events).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/b/[id]/events">) {
  const { id: businessId } = await ctx.params;
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  let lastId =
    sinceParam !== null
      ? Number(sinceParam)
      : (db
          .select({ id: schema.activityEvents.id })
          .from(schema.activityEvents)
          .where(eq(schema.activityEvents.businessId, businessId))
          .orderBy(desc(schema.activityEvents.id))
          .limit(1)
          .get()?.id ?? 0);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let pings = 0;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("ready", { lastId });
      timer = setInterval(() => {
        try {
          const rows = db
            .select()
            .from(schema.activityEvents)
            .where(and(eq(schema.activityEvents.businessId, businessId), gt(schema.activityEvents.id, lastId)))
            .orderBy(asc(schema.activityEvents.id))
            .limit(200)
            .all();
          for (const row of rows) {
            lastId = row.id;
            send("activity", row);
          }
          if (++pings % 30 === 0) send("ping", {});
        } catch {
          clearInterval(timer);
          controller.close();
        }
      }, 700);
    },
    cancel() {
      clearInterval(timer);
    },
  });

  req.signal.addEventListener("abort", () => clearInterval(timer));

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
