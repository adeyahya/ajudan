import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { contactsCsv } from "@/lib/contacts";
import { contactsVcf } from "@/lib/contact-vcard";

/** The address book as CSV (Contacts → Export), or as vCard with ?format=vcf. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/b/[id]/contacts">) {
  const { id } = await ctx.params;
  const business = db.select({ name: schema.businesses.name }).from(schema.businesses).where(eq(schema.businesses.id, id)).get();
  if (!business) return new Response("Not found", { status: 404 });
  const vcf = req.nextUrl.searchParams.get("format") === "vcf";
  const name = `${business.name.replace(/[^\w-]+/g, "-")}-contacts.${vcf ? "vcf" : "csv"}`;
  return new Response(vcf ? contactsVcf(id) : contactsCsv(id), {
    headers: {
      "Content-Type": vcf ? "text/vcard; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
