import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contact } from "@/db/schema";
import { cleanTags } from "@/lib/assets";
import { cleanFields, listContacts } from "@/lib/contacts";
import { recordHistory } from "@/lib/object-history";
import { softDelete } from "@/lib/trash";

/**
 * Duplicate contacts: the same phone, the same email, or a near-identical name ("Rina
 * Sari" / "rina  sari" / "Sari Rina" / "Rina Sarri"). Merging keeps one, unions the
 * others' tags, fields and notes into it, fills its empty details, repoints their links,
 * and moves them to Trash. The kept contact's history records which ones it absorbed
 * (`mergedFrom`), so the timeline still shows their interactions.
 */

export type DuplicateReason = "phone" | "email" | "name";
export type DuplicateGroup = { keep: Contact; others: Contact[]; reasons: DuplicateReason[] };

/** "Bü Rina-Sari " → "bu rina sari". */
export function normalizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Levenshtein distance, giving up (returning max + 1) once it's over `max`. */
function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Same name once normalized, the same words in another order, or one typo apart (names of 6+ letters). */
export function similarNames(a: string, b: string) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.split(" ").sort().join(" ") === y.split(" ").sort().join(" ")) return true;
  return Math.min(x.length, y.length) >= 6 && editDistance(x, y, 1) <= 1;
}

/** How complete a contact is: the one to keep has the most filled in, then is the oldest. */
const richness = (c: Contact) =>
  (c.phone ? 2 : 0) + (c.email ? 2 : 0) + (c.company ? 1 : 0) + c.tags.length * 0.2 + Object.keys(c.fields ?? {}).length * 0.5 + (c.notes ? 1 : 0) + (c.followUpAt ? 1 : 0);

/** Groups of contacts that look like the same person, from a list (pure; for tests and the page). */
export function groupDuplicates(contacts: Contact[]): DuplicateGroup[] {
  const parent = contacts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reasons = new Map<number, Set<DuplicateReason>>();
  const join = (i: number, j: number, why: DuplicateReason) => {
    const a = find(i);
    const b = find(j);
    const r = new Set([...(reasons.get(a) ?? []), ...(reasons.get(b) ?? []), why]);
    if (a !== b) parent[b] = a;
    reasons.set(find(i), r);
  };
  const byKey = (key: (c: Contact) => string | null, why: DuplicateReason) => {
    const seen = new Map<string, number>();
    contacts.forEach((c, i) => {
      const k = key(c);
      if (!k) return;
      const first = seen.get(k);
      if (first === undefined) seen.set(k, i);
      else join(first, i, why);
    });
  };
  byKey((c) => c.phone || null, "phone");
  byKey((c) => c.email?.toLowerCase() || null, "email");
  // Names: compare within buckets of the same first letter of a sorted word, so it stays near-linear.
  const buckets = new Map<string, number[]>();
  contacts.forEach((c, i) => {
    const words = normalizeName(c.name).split(" ").filter(Boolean);
    for (const k of new Set(words.map((w) => w[0]))) buckets.set(k, [...(buckets.get(k) ?? []), i]);
  });
  for (const idx of buckets.values()) {
    if (idx.length > 400) continue; // a huge bucket: exact-match pass below covers the common case
    for (let a = 0; a < idx.length; a++)
      for (let b = a + 1; b < idx.length; b++) if (find(idx[a]) !== find(idx[b]) && similarNames(contacts[idx[a]].name, contacts[idx[b]].name)) join(idx[a], idx[b], "name");
  }
  byKey((c) => normalizeName(c.name).split(" ").sort().join(" ") || null, "name");

  const groups = new Map<number, Contact[]>();
  contacts.forEach((c, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), c]));
  return [...groups.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([root, g]) => {
      const sorted = [...g].sort((a, b) => richness(b) - richness(a) || a.createdAt.getTime() - b.createdAt.getTime());
      return { keep: sorted[0], others: sorted.slice(1), reasons: [...(reasons.get(root) ?? [])].sort() };
    })
    .sort((a, b) => a.keep.name.localeCompare(b.keep.name));
}

/** The business's duplicate groups (Trash left out). */
export function findDuplicateContacts(businessId: string) {
  return groupDuplicates(listContacts(businessId));
}

/**
 * Merge `otherIds` into `keepId`. The kept contact keeps its own values and gets the
 * others' tags, fields it lacks, notes it doesn't have yet, and any empty phone, email,
 * company or follow-up filled in. Links move to it; the others go to Trash.
 */
export function mergeContacts(businessId: string, keepId: string, otherIds: string[], by = "owner") {
  const ids = [...new Set(otherIds)].filter((id) => id !== keepId);
  if (!ids.length) return { error: "Pick at least one other contact to merge." };
  const t = schema.contacts;
  const rows = db
    .select()
    .from(t)
    .where(and(eq(t.businessId, businessId), isNull(t.deletedAt), inArray(t.id, [keepId, ...ids])))
    .all();
  const keep = rows.find((r) => r.id === keepId);
  const others = rows.filter((r) => r.id !== keepId);
  if (!keep) return { error: "Contact not found." };
  if (others.length !== ids.length) return { error: "Some of those contacts aren't in the address book any more." };

  const notes = [keep.notes, ...others.map((o) => o.notes)].map((n) => n.trim()).filter(Boolean);
  const mergedNotes = notes.filter((n, i) => !notes.slice(0, i).some((p) => p.includes(n))).join("\n").slice(0, 4000);
  const follow = keep.followUpAt ? keep : others.filter((o) => o.followUpAt).sort((a, b) => a.followUpAt!.getTime() - b.followUpAt!.getTime())[0];
  let fields: Record<string, string> = {};
  for (const o of [...others].reverse()) fields = { ...fields, ...o.fields };
  const patch = {
    phone: keep.phone ?? others.find((o) => o.phone)?.phone ?? null,
    email: keep.email ?? others.find((o) => o.email)?.email ?? null,
    company: keep.company ?? others.find((o) => o.company)?.company ?? null,
    tags: cleanTags([...keep.tags, ...others.flatMap((o) => o.tags)]),
    fields: cleanFields({ ...fields, ...keep.fields }),
    notes: mergedNotes,
    followUpAt: follow?.followUpAt ?? null,
    followUpNote: follow?.followUpNote ?? "",
    updatedBy: by,
  };

  const merged = db.transaction((tx) => {
    const row = tx.update(t).set(patch).where(eq(t.id, keepId)).returning().get();
    // Repoint links: each other contact's links become the kept one's (no duplicates, no self-links).
    const l = schema.links;
    const links = tx
      .select()
      .from(l)
      .where(
        and(
          eq(l.businessId, businessId),
          or(and(eq(l.fromType, "contact"), inArray(l.fromId, ids)), and(eq(l.toType, "contact"), inArray(l.toId, ids))),
        ),
      )
      .all();
    for (const link of links) {
      const swap = (type: string, id: string) => (type === "contact" && ids.includes(id) ? keepId : id);
      const fromId = swap(link.fromType, link.fromId);
      const toId = swap(link.toType, link.toId);
      tx.delete(l).where(eq(l.id, link.id)).run();
      if (link.fromType === link.toType && fromId === toId) continue;
      tx.insert(l)
        .values({ businessId, fromType: link.fromType, fromId, toType: link.toType, toId, createdBy: link.createdBy, createdAt: link.createdAt })
        .onConflictDoNothing()
        .run();
    }
    recordHistory({ businessId, type: "contact", id: keepId, snapshot: { ...row, mergedFrom: ids }, action: "update", by });
    for (const id of ids) softDelete(businessId, "contact", id, by);
    return row;
  });
  return { contact: merged, merged: ids.length };
}
