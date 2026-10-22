import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { contactsCsv } from "@/lib/contacts";

/** The address book as CSV (Studio → Contacts → Export). */
export async function GET(_req: Request, ctx: RouteContext<"/api/b/[id]/contacts">) {
  const { id } = await ctx.params;
  const business = db.select({ name: schema.businesses.name }).from(schema.businesses).where(eq(schema.businesses.id, id)).get();
  if (!business) return new Response("Not found", { status: 404 });
  const name = `${business.name.replace(/[^\w-]+/g, "-")}-contacts.csv`;
  return new Response(contactsCsv(id), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
