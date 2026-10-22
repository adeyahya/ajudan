"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import type { DeliverableStatus } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { syncDeliverableFile } from "@/lib/workfiles";

const STATUSES: DeliverableStatus[] = ["draft", "ready_to_post", "approved", "published", "rejected"];

/** FormData: businessId, deliverableId, status. */
export async function setDeliverableStatus(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const deliverableId = String(formData.get("deliverableId") ?? "");
  const status = String(formData.get("status") ?? "") as DeliverableStatus;
  if (!STATUSES.includes(status)) throw new Error("Invalid status");
  const d = db
    .update(schema.deliverables)
    .set({ status })
    .where(and(eq(schema.deliverables.id, deliverableId), eq(schema.deliverables.businessId, businessId)))
    .returning()
    .get();
  if (!d) throw new Error("Deliverable not found");
  syncDeliverableFile(d.id);
  logEvent({
    businessId,
    teammateId: d.teammateId,
    taskId: d.taskId,
    type: "deliverable_status",
    message: `Owner marked "${d.title}" as ${status}`,
    data: { deliverableId: d.id, status },
  });
  refresh();
}
