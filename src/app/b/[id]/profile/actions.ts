"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { lines, textToGoals } from "@/lib/onboarding/profile-form";
import { BusinessProfileSchema } from "@/lib/types";
import { initTeammateWorkspace } from "@/lib/workspace";

export type ProfileFormState = { error?: string; ok?: boolean };

export async function saveProfile(businessId: string, _prev: ProfileFormState, fd: FormData): Promise<ProfileFormState> {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz?.profile) return { error: "No profile to edit yet" };

  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const name = str("name") || biz.name;
  const website = str("website") || null;
  const parsed = BusinessProfileSchema.safeParse({
    name,
    website,
    oneLiner: str("oneLiner"),
    description: str("description"),
    products: lines(fd.get("products")),
    targetCustomers: lines(fd.get("targetCustomers")),
    channels: lines(fd.get("channels")),
    brandVoice: str("brandVoice"),
    competitors: lines(fd.get("competitors")),
    goals: textToGoals(fd.get("goals")),
    constraints: lines(fd.get("constraints")),
    teamNeeds: lines(fd.get("teamNeeds")),
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const profile = parsed.data;

  db.update(schema.businesses).set({ profile, name, website }).where(eq(schema.businesses.id, businessId)).run();

  const active = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
    .all();
  for (const t of active) {
    const workspaceDir = initTeammateWorkspace(t, profile);
    if (workspaceDir !== t.workspaceDir) {
      db.update(schema.teammates).set({ workspaceDir }).where(eq(schema.teammates.id, t.id)).run();
    }
  }
  refresh();
  return { ok: true };
}
