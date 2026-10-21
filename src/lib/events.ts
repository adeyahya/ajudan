import { db, schema } from "@/db";

/**
 * Append to the activity feed. The SSE endpoint streams these rows to the browser,
 * which drives the office animations and refreshes pages.
 */
export function logEvent(e: {
  businessId: string;
  teammateId?: string | null;
  taskId?: string | null;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  db.insert(schema.activityEvents)
    .values({
      businessId: e.businessId,
      teammateId: e.teammateId ?? null,
      taskId: e.taskId ?? null,
      type: e.type,
      message: e.message.slice(0, 2000),
      data: e.data,
    })
    .run();
}
