import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { queryOfficeState } from "@/app/b/[id]/office/state";

/** Live office state: active teammates, pending approvals and task counts. Refetched on each activity event. */
export async function GET(_req: Request, ctx: RouteContext<"/api/b/[id]/state">) {
  const { id } = await ctx.params;
  const business = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, id)).get();
  if (!business) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(queryOfficeState(id), { headers: { "Cache-Control": "no-store" } });
}
