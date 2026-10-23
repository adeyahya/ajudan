import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { deskChats, deskMessages, deskScore, deskSummaries } from "@/lib/desk";
import { restFor } from "@/lib/rest";

/** Customer Desk data, polled by the page: the chat list (or one chat's messages with ?chat=). */
export async function GET(req: Request, ctx: RouteContext<"/api/b/[id]/desk">) {
  const { id } = await ctx.params;
  const business = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, id)).get();
  if (!business) return Response.json({ error: "not found" }, { status: 404 });
  const headers = { "Cache-Control": "no-store" };
  const chat = new URL(req.url).searchParams.get("chat");
  try {
    if (chat) {
      if (!deskChats(id).some((c) => c.jid === chat)) return Response.json({ error: "not a desk chat" }, { status: 404 });
      return Response.json({ messages: await deskMessages(chat) }, { headers });
    }
    return Response.json({ chats: await deskSummaries(id), score: deskScore(id), rest: restFor(id) }, { headers });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502, headers });
  }
}
