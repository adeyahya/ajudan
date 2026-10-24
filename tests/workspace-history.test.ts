import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-workspace-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { recordHistory, historyFor, restoreVersion, canUndoEntry, recentTeamHistory, supersededIds } = await import("@/lib/object-history");
const { softDelete, listTrash, purgeOlderThan } = await import("@/lib/trash");
const { newFromTeam, keepReviewItem, markReviewSeen } = await import("@/lib/home");
const { dueFollowUps } = await import("@/lib/contacts");
const { addLink, findLinkTargets, linksFor } = await import("@/lib/links");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let businessId: string;
let mateId: string;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
  businessId = db.insert(schema.businesses).values({ name: "Test" }).returning().get().id;
  mateId = db.insert(schema.teammates).values({ businessId, name: "Raka", roleKey: "copywriter", title: "Copywriter" }).returning().get().id;
});

describe("restoreVersion", () => {
  it("undoes a teammate's update from its `before`, and records a restore that can be undone too", () => {
    const c = db
      .insert(schema.contacts)
      .values({ businessId, name: "Budi", phone: "62811", notes: "Likes batik", followUpAt: new Date("2026-11-01T00:00:00Z") })
      .returning()
      .get();
    // A teammate's update: the snapshot is the new version, `before` what it replaced.
    db.update(schema.contacts).set({ name: "Budi S.", notes: "Wrong notes", followUpAt: null, updatedBy: `teammate:${mateId}` }).where(eq(schema.contacts.id, c.id)).run();
    const changed = db.select().from(schema.contacts).where(eq(schema.contacts.id, c.id)).get()!;
    const entry = recordHistory({ businessId, type: "contact", id: c.id, snapshot: changed, before: c, action: "update", by: `teammate:${mateId}` });

    expect(restoreVersion(businessId, entry.id, "owner", "before")).toBe(true);
    const after = db.select().from(schema.contacts).where(eq(schema.contacts.id, c.id)).get()!;
    expect(after).toMatchObject({ name: "Budi", notes: "Likes batik", updatedBy: "owner" });
    expect(after.followUpAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");

    const [latest] = historyFor(businessId, "contact", c.id);
    expect(latest.action).toBe("restore");
    expect(latest.by).toBe("owner");
    expect(latest.snapshot.notes).toBe("Likes batik");
    expect((latest.snapshot.before as { notes: string }).notes).toBe("Wrong notes");
    // ...so the restore can itself be undone, and the teammate's version restored again.
    expect(restoreVersion(businessId, latest.id, "owner", "before")).toBe(true);
    expect(db.select().from(schema.contacts).where(eq(schema.contacts.id, c.id)).get()!.notes).toBe("Wrong notes");
    expect(restoreVersion(businessId, entry.id)).toBe(true);
    expect(db.select().from(schema.contacts).where(eq(schema.contacts.id, c.id)).get()!.notes).toBe("Wrong notes");
  });

  it("restores a version of a deliverable and a library file's organization; refuses unknown or gone objects", () => {
    const d = db.insert(schema.deliverables).values({ businessId, kind: "plan", title: "Q4 plan", content: "v1" }).returning().get();
    const e = recordHistory({ businessId, type: "deliverable", id: d.id, snapshot: d, action: "update", by: `teammate:${mateId}` });
    db.update(schema.deliverables).set({ title: "Q4 plan (rev)", content: "v2" }).where(eq(schema.deliverables.id, d.id)).run();
    expect(restoreVersion(businessId, e.id)).toBe(true);
    expect(db.select().from(schema.deliverables).where(eq(schema.deliverables.id, d.id)).get()).toMatchObject({ title: "Q4 plan", content: "v1" });

    fs.writeFileSync(path.join(dir, "media", "shop.jpg"), "x");
    const a = db.insert(schema.assets).values({ path: "media/shop.jpg", businessId, title: "Shop", tags: ["front"] }).returning().get();
    const ae = recordHistory({ businessId, type: "asset", id: a.path, snapshot: a, action: "update", by: `teammate:${mateId}` });
    db.update(schema.assets).set({ title: "Wrong", tags: [] }).where(eq(schema.assets.path, a.path)).run();
    expect(restoreVersion(businessId, ae.id)).toBe(true);
    expect(db.select().from(schema.assets).where(eq(schema.assets.path, a.path)).get()).toMatchObject({ title: "Shop", tags: ["front"] });

    expect(restoreVersion(businessId, "nope")).toBe(false);
    const gone = recordHistory({ businessId, type: "contact", id: "missing", snapshot: { name: "X" }, action: "update", by: "owner" });
    expect(restoreVersion(businessId, gone.id)).toBe(false);
    const task = recordHistory({ businessId, type: "task", id: "t1", snapshot: { title: "x" }, action: "update", by: "owner" });
    expect(restoreVersion(businessId, task.id)).toBe(false);
  });

  it("lists team changes, marks superseded ones, and says what can be undone", () => {
    const team = recentTeamHistory(businessId, 50);
    expect(team.every((h) => h.by.startsWith("teammate:"))).toBe(true);
    const sup = supersededIds(businessId, team);
    // The contact update was followed by the owner's restores.
    const contactUpdate = team.find((h) => h.objectType === "contact")!;
    expect(sup.has(contactUpdate.id)).toBe(true);
    expect(canUndoEntry(contactUpdate)).toBe(true);
    expect(canUndoEntry({ action: "create", objectType: "contact", snapshot: {} })).toBe(true);
    expect(canUndoEntry({ action: "create", objectType: "task", snapshot: {} })).toBe(false);
    expect(canUndoEntry({ action: "update", objectType: "contact", snapshot: { id: "x", name: "No before" } })).toBe(false);
    expect(canUndoEntry({ action: "update", objectType: "contact", snapshot: { name: "B", before: { name: "A" } } })).toBe(true);
    // A logged interaction is not a version of the contact.
    expect(canUndoEntry({ action: "update", objectType: "contact", snapshot: { interaction: { kind: "call", text: "hi" } } })).toBe(false);
  });
});

describe("purgeOlderThan", () => {
  it("deletes for good only what has been in Trash longer than the cutoff", () => {
    const old = db.insert(schema.contacts).values({ businessId, name: "Old one" }).returning().get();
    const recent = db.insert(schema.contacts).values({ businessId, name: "Recent one" }).returning().get();
    softDelete(businessId, "contact", old.id);
    softDelete(businessId, "contact", recent.id);
    db.update(schema.contacts).set({ deletedAt: new Date(Date.now() - 31 * DAY) }).where(eq(schema.contacts.id, old.id)).run();
    addLink(businessId, { type: "contact", id: old.id }, { type: "contact", id: recent.id });

    expect(purgeOlderThan(businessId, 30)).toBe(1);
    expect(db.select().from(schema.contacts).where(eq(schema.contacts.id, old.id)).get()).toBeUndefined();
    expect(listTrash(businessId).map((i) => i.id)).toContain(recent.id);
    expect(linksFor(businessId, { type: "contact", id: recent.id })).toHaveLength(0);
  });
});

describe("Home", () => {
  it("queues what teammates made since the last look, minus Trash and kept items", () => {
    const since = Date.now() - 1000;
    const by = `teammate:${mateId}`;
    const doc = db.insert(schema.deliverables).values({ businessId, kind: "post", title: "Promo post", content: "...", createdBy: by }).returning().get();
    const legacy = db.insert(schema.deliverables).values({ businessId, kind: "post", title: "Legacy post", content: "...", teammateId: mateId }).returning().get();
    db.insert(schema.deliverables).values({ businessId, kind: "post", title: "Mine", content: "...", createdBy: "owner" }).run();
    const page = db.insert(schema.contextPages).values({ businessId, title: "Supplier notes", createdBy: by }).returning().get();
    const person = db.insert(schema.contacts).values({ businessId, name: "Sari", createdBy: by }).returning().get();
    const trashed = db.insert(schema.contacts).values({ businessId, name: "Trashed", createdBy: by }).returning().get();
    softDelete(businessId, "contact", trashed.id);

    const ids = (opts?: Parameters<typeof newFromTeam>[1]) => newFromTeam(businessId, { since, kept: [], ...opts }).map((i) => i.id).sort();
    expect(ids()).toEqual([doc.id, legacy.id, page.id, person.id].sort());
    expect(ids({ kept: [`contact:${person.id}`] })).not.toContain(person.id);

    // The stored state: keep one, then clear the queue.
    markReviewSeen(businessId, since);
    keepReviewItem(businessId, { type: "doc", id: page.id });
    expect(newFromTeam(businessId).map((i) => i.id)).not.toContain(page.id);
    expect(newFromTeam(businessId).map((i) => i.id)).toContain(doc.id);
    markReviewSeen(businessId);
    expect(newFromTeam(businessId)).toHaveLength(0);
  });

  it("lists follow-ups due, soonest first, leaving Trash out", () => {
    const soon = db.insert(schema.contacts).values({ businessId, name: "Due", followUpAt: new Date(Date.now() - DAY) }).returning().get();
    db.insert(schema.contacts).values({ businessId, name: "Later", followUpAt: new Date(Date.now() + 5 * DAY) }).run();
    const gone = db.insert(schema.contacts).values({ businessId, name: "Gone", followUpAt: new Date(Date.now() - DAY) }).returning().get();
    softDelete(businessId, "contact", gone.id);
    expect(dueFollowUps(businessId).map((c) => c.id)).toEqual([soon.id]);
  });

  it("finds link targets by title", () => {
    const hits = findLinkTargets(businessId, "Promo");
    expect(hits.some((h) => h.type === "deliverable" && h.title === "Promo post")).toBe(true);
    expect(findLinkTargets(businessId, "")).toEqual([]);
  });
});
