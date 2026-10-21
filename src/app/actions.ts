"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { enqueueJob } from "@/lib/jobs";

function normalizeWebsite(raw: string) {
  const w = raw.trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

export async function createBusiness(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Business name is required");
  const website = normalizeWebsite(String(formData.get("website") ?? ""));

  const biz = db
    .insert(schema.businesses)
    .values({ name, website, status: "onboarding", busy: true })
    .returning({ id: schema.businesses.id })
    .get();
  try {
    enqueueJob("onboarding_turn", { businessId: biz.id });
  } catch (err) {
    db.update(schema.businesses).set({ busy: false }).where(eq(schema.businesses.id, biz.id)).run();
    throw err;
  }
  redirect(`/b/${biz.id}/onboarding`);
}
