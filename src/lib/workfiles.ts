import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { slugify } from "@/lib/folders";
import { workDir } from "@/lib/paths";

/**
 * Mirror a deliverable to <folder>/work/<date>-<title>.md so the business folder
 * holds the team's work as plain files you can open, share or back up.
 * The database stays the source of truth; call this after every change.
 */
export function syncDeliverableFile(deliverableId: string) {
  const d = db.select().from(schema.deliverables).where(eq(schema.deliverables.id, deliverableId)).get();
  if (!d) return;
  const who = d.teammateId
    ? db.select({ name: schema.teammates.name }).from(schema.teammates).where(eq(schema.teammates.id, d.teammateId)).get()
        ?.name
    : undefined;
  const dir = workDir();
  fs.mkdirSync(dir, { recursive: true });
  const day = d.createdAt.toISOString().slice(0, 10);
  const file = path.join(dir, `${day}-${slugify(d.title)}-${d.id.slice(0, 6)}.md`);
  const meta = [
    `title: ${JSON.stringify(d.title)}`,
    `kind: ${d.kind}`,
    d.channel ? `channel: ${d.channel}` : null,
    `status: ${d.status}`,
    who ? `by: ${who}` : null,
    `created: ${d.createdAt.toISOString()}`,
    `id: ${d.id}`,
  ].filter(Boolean);
  // Images live in work/images/, so links from work/*.md are relative to it.
  const images = d.attachments.map((p, i) => `![${d.title} ${i + 1}](${path.relative("work", p)})`).join("\n\n");
  fs.writeFileSync(file, `---\n${meta.join("\n")}\n---\n\n# ${d.title}\n\n${images ? `${images}\n\n` : ""}${d.content}\n`);
}
