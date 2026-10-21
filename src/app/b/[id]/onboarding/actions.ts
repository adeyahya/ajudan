"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { enqueueJob } from "@/lib/jobs";

function getBiz(businessId: string) {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  return biz;
}

function setBusy(businessId: string, busy: boolean) {
  db.update(schema.businesses).set({ busy }).where(eq(schema.businesses.id, businessId)).run();
}

export async function sendAnswer(businessId: string, formData: FormData) {
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;
  const biz = getBiz(businessId);
  if (biz.busy) throw new Error("The interviewer is still thinking");
  db.insert(schema.onboardingMessages).values({ businessId, role: "user", content }).run();
  setBusy(businessId, true);
  enqueueJob("onboarding_turn", { businessId });
  refresh();
}

export async function finishInterview(businessId: string) {
  const biz = getBiz(businessId);
  if (biz.busy) throw new Error("The interviewer is still thinking");
  setBusy(businessId, true);
  enqueueJob("onboarding_finalize", { businessId });
  refresh();
}

/** Re-run whichever job failed last ("turn" or "finalize"). */
export async function retryOnboarding(businessId: string, job: "turn" | "finalize") {
  const biz = getBiz(businessId);
  if (biz.busy) return;
  setBusy(businessId, true);
  enqueueJob(job === "finalize" ? "onboarding_finalize" : "onboarding_turn", { businessId });
  refresh();
}

/** Chat entry point: same as sendAnswer, taking the text directly. */
export async function sendInterviewMessage(businessId: string, content: string) {
  const fd = new FormData();
  fd.set("content", content);
  await sendAnswer(businessId, fd);
}
