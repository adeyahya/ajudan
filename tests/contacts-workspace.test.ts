import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Contact } from "@/db/schema";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-contacts-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const contacts = await import("@/lib/contacts");
const { parseVcards, contactToVcard, importVcards, contactsVcf } = await import("@/lib/contact-vcard");
const { groupDuplicates, mergeContacts, similarNames } = await import("@/lib/contact-duplicates");
const { contactTimeline } = await import("@/lib/contact-timeline");
const { saveSegment, listSegments, segmentContacts, getSegment, deleteSegment } = await import("@/lib/contact-segments");
const { addLink, linksFor } = await import("@/lib/links");
const { historyFor } = await import("@/lib/object-history");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let businessId: string;
beforeAll(() => {
  businessId = db.insert(schema.businesses).values({ name: "Test", language: "id" }).returning().get().id;
});

const add = (name: string, extra: Partial<typeof schema.contacts.$inferInsert> = {}) => db.insert(schema.contacts).values({ businessId, name, ...extra }).returning().get();

describe("vCard", () => {
  it("parses several cards: folding, escapes, N without FN, quoted-printable, categories", () => {
    const text = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Rina Sari",
      "N:Sari;Rina;;;",
      "TEL;TYPE=WORK:+62 21 555 0000",
      "TEL;TYPE=CELL,PREF:+62 812-1111-2222",
      "EMAIL;TYPE=INTERNET:RINA@example.com",
      "ORG:Toko Rina;Jakarta",
      "NOTE:Likes blue\\, not red.\\nPays on time; a long note that",
      "  continues on the next line",
      "CATEGORIES:VIP,reseller",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:2.1",
      "N:Wijaya;Budi;;Pak;",
      "TEL;CELL:0813 3333 4444",
      "NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Caf=C3=A9 owner, =",
      "Bandung",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:4.0",
      "EMAIL:nobody@example.com",
      "END:VCARD",
    ].join("\r\n");
    const cards = parseVcards(text);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ name: "Rina Sari", phone: "+62 812-1111-2222", email: "RINA@example.com", company: "Toko Rina", tags: ["VIP", "reseller"] });
    expect(cards[0].notes).toBe("Likes blue, not red.\nPays on time; a long note that continues on the next line");
    expect(cards[0].fields).toEqual({ "Phone 2": "+62 21 555 0000" });
    expect(cards[1]).toMatchObject({ name: "Pak Budi Wijaya", phone: "0813 3333 4444", notes: "Café owner, Bandung" });
  });

  it("round-trips kind, fields and special characters, and imports by merging on phone", () => {
    const vcf = contactToVcard({
      name: "Ana; the \"best\"",
      phone: "6281200000001",
      email: "ana@example.com",
      company: "A, B & Co",
      kind: "supplier",
      tags: ["paper"],
      notes: "Line 1\nLine 2 " + "x".repeat(120),
      fields: { Birthday: "12 May", "Shoe size": "40" },
    });
    expect(vcf.split("\r\n").every((l) => [...l].length <= 75)).toBe(true);
    const [back] = parseVcards(vcf);
    expect(back).toMatchObject({ name: 'Ana; the "best"', phone: "+6281200000001", company: "A, B & Co", kind: "supplier", tags: ["paper"], fields: { Birthday: "12 May", "Shoe size": "40" } });
    expect(back.notes).toBe("Line 1\nLine 2 " + "x".repeat(120));

    const r1 = importVcards(businessId, vcf);
    expect(r1).toMatchObject({ added: 1, updated: 0 });
    const r2 = importVcards(businessId, vcf.replace("CATEGORIES:paper", "CATEGORIES:carton"));
    expect(r2).toMatchObject({ added: 0, updated: 1 });
    const ana = contacts.listContacts(businessId).find((c) => c.phone === "6281200000001")!;
    expect(ana.kind).toBe("supplier");
    expect(ana.tags.sort()).toEqual(["carton", "paper"]);
    expect(ana.fields).toEqual({ Birthday: "12 May", "Shoe size": "40" });
    expect(contactsVcf(businessId)).toContain("FN:Ana\\; the \"best\"");
  });

  it("keeps a number it can't read as a field instead of skipping the person", () => {
    const r = importVcards(businessId, "BEGIN:VCARD\nVERSION:3.0\nFN:Short Number\nTEL:12345\nEND:VCARD\n");
    expect(r.added).toBe(1);
    const c = contacts.listContacts(businessId).find((x) => x.name === "Short Number")!;
    expect(c.phone).toBeNull();
    expect(c.fields.Phone).toBe("12345");
  });
});

describe("CSV custom fields", () => {
  it("imports unknown columns as fields and exports them as columns", () => {
    const r = contacts.importContacts(businessId, "name,phone,Birthday,Phone 1 - Type\nCsv Person,+6281299990000,1 Jan,Mobile\n");
    expect(r.added).toBe(1);
    const c = contacts.listContacts(businessId).find((x) => x.name === "Csv Person")!;
    expect(c.fields).toEqual({ Birthday: "1 Jan" });
    const csv = contacts.contactsCsv(businessId);
    const [header, ...rows] = csv.trim().split("\n");
    expect(header.split(",")).toContain("Birthday");
    expect(rows.find((l) => l.startsWith("Csv Person"))).toContain("1 Jan");
  });
});

describe("duplicates", () => {
  const fake = (id: string, name: string, extra: Partial<Contact> = {}, age = 0): Contact => ({
    id,
    businessId: "b",
    name,
    phone: null,
    email: null,
    company: null,
    kind: "customer",
    tags: [],
    notes: "",
    createdBy: "owner",
    updatedBy: "owner",
    followUpAt: null,
    followUpNote: "",
    fields: {},
    deletedAt: null,
    createdAt: new Date(Date.now() - age),
    ...extra,
  });

  it("matches near-identical names", () => {
    expect(similarNames("Rina Sari", "rina  sari")).toBe(true);
    expect(similarNames("Rina Sari", "Sari Rina")).toBe(true);
    expect(similarNames("Rina Sari", "Rina Sarri")).toBe(true);
    expect(similarNames("Ani", "Ana")).toBe(false);
    expect(similarNames("Rina Sari", "Rina Putri")).toBe(false);
  });

  it("groups by phone, email or name, transitively, and keeps the most complete one", () => {
    const groups = groupDuplicates([
      fake("1", "Rina", { phone: "628111" }, 3000),
      fake("2", "Bu Rina", { phone: "628111", email: "r@x.com", company: "Toko" }, 2000),
      fake("3", "R. Sari", { email: "R@X.com" }, 1000),
      fake("4", "Budi Santoso", {}, 500),
      fake("5", "budi santoso", {}, 400),
      fake("6", "Someone Else"),
    ]);
    expect(groups).toHaveLength(2);
    const rina = groups.find((g) => g.keep.id === "2")!;
    expect(rina.others.map((o) => o.id).sort()).toEqual(["1", "3"]);
    expect(rina.reasons).toEqual(["email", "phone"]);
    const budi = groups.find((g) => g.keep.id === "4")!;
    expect(budi.others.map((o) => o.id)).toEqual(["5"]);
    expect(budi.reasons).toEqual(["name"]);
  });

  it("merges: unions tags/fields/notes, fills gaps, repoints links, trashes the rest, records history", () => {
    const keep = add("Dewi Lestari", { phone: "6281300000001", tags: ["vip"], notes: "Prefers mornings", fields: { City: "Bandung" } });
    const other = add("dewi lestari", { email: "dewi@example.com", tags: ["reseller"], notes: "Ordered 50 pcs", fields: { City: "Jakarta", Birthday: "3 Mar" }, followUpAt: new Date(Date.now() + 86_400_000), followUpNote: "Send catalog" });
    const deliverable = db.insert(schema.deliverables).values({ businessId, kind: "report", title: "Q3 plan", content: "x" }).returning().get();
    addLink(businessId, { type: "contact", id: other.id }, { type: "deliverable", id: deliverable.id });
    addLink(businessId, { type: "deliverable", id: deliverable.id }, { type: "contact", id: other.id });
    addLink(businessId, { type: "contact", id: other.id }, { type: "contact", id: keep.id }); // becomes a self-link: dropped
    contacts.logInteraction(businessId, other.id, "call", "Asked about prices");

    const r = mergeContacts(businessId, keep.id, [other.id]);
    expect("error" in r).toBe(false);
    const merged = contacts.getContact(businessId, keep.id)!;
    expect(merged.tags.sort()).toEqual(["reseller", "vip"]);
    expect(merged.fields).toEqual({ City: "Bandung", Birthday: "3 Mar" });
    expect(merged.notes).toBe("Prefers mornings\nOrdered 50 pcs");
    expect(merged.email).toBe("dewi@example.com");
    expect(merged.followUpNote).toBe("Send catalog");
    expect(contacts.getContact(businessId, other.id)).toBeUndefined();
    expect(db.select().from(schema.contacts).where(eq(schema.contacts.id, other.id)).get()?.deletedAt).toBeTruthy();

    const links = linksFor(businessId, { type: "contact", id: keep.id });
    expect(links.map((l) => `${l.direction}:${l.type}`).sort()).toEqual(["in:deliverable", "out:deliverable"]);
    expect(linksFor(businessId, { type: "contact", id: other.id })).toHaveLength(0);
    expect(historyFor(businessId, "contact", keep.id)[0].snapshot.mergedFrom).toEqual([other.id]);

    // The merged-in contact's interactions still show on the kept one.
    const tl = contactTimeline(businessId, keep.id);
    expect(tl.some((i) => i.kind === "interaction" && i.title === "Asked about prices")).toBe(true);
    expect(tl.some((i) => i.kind === "change" && i.change === "merge")).toBe(true);
  });
});

describe("follow-ups and timeline", () => {
  it("dueFollowUps: overdue and due by the end of today, soonest first, no Trash or future", () => {
    const now = Date.now();
    const overdue = add("Due Overdue", { followUpAt: new Date(now - 3 * 86_400_000) });
    const today = add("Due Today", { followUpAt: contacts.endOfToday(new Date(now)) });
    add("Due Later", { followUpAt: new Date(now + 5 * 86_400_000) });
    const trashed = add("Due Trashed", { followUpAt: new Date(now - 86_400_000) });
    contacts.deleteContact(businessId, trashed.id);
    const due = contacts.dueFollowUps(businessId).filter((c) => c.name.startsWith("Due "));
    expect(due.map((c) => c.id)).toEqual([overdue.id, today.id]);
    const week = contacts.dueFollowUps(businessId, new Date(now + 7 * 86_400_000)).filter((c) => c.name.startsWith("Due "));
    expect(week.map((c) => c.name)).toEqual(["Due Overdue", "Due Today", "Due Later"]);
  });

  it("set, done and log show in the timeline with who did it; owner edits record history", () => {
    const saved = contacts.saveContact(businessId, { name: "Timeline Person", phone: "+62 811 7777 8888" });
    if ("error" in saved) throw new Error(saved.error);
    const id = saved.contact.id;
    expect(historyFor(businessId, "contact", id)[0]).toMatchObject({ action: "create", by: "owner" });
    const upd = contacts.saveContact(businessId, { id, name: "Timeline Person", phone: "+62 811 7777 8888", fields: { Size: "L" } });
    if ("error" in upd) throw new Error(upd.error);
    expect(upd.contact.fields).toEqual({ Size: "L" });
    expect(upd.contact.updatedBy).toBe("owner");

    contacts.setFollowUp(businessId, id, new Date(Date.now() + 86_400_000), "Check the sample", "teammate:abc");
    expect(contacts.getContact(businessId, id)?.updatedBy).toBe("teammate:abc");
    contacts.completeFollowUp(businessId, id);
    contacts.logInteraction(businessId, id, "meeting", "Agreed on 100 pcs", "owner");
    expect(contacts.getContact(businessId, id)?.followUpAt).toBeNull();

    const mate = db.insert(schema.teammates).values({ businessId, name: "Raka", roleKey: "sales", title: "Sales" }).returning().get();
    db.insert(schema.tasks).values({ businessId, teammateId: mate.id, title: "Call Timeline Person", instructions: "Call Timeline Person about the order" }).run();

    const tl = contactTimeline(businessId, id, 10);
    const kinds = tl.map((i) => `${i.kind}${i.followUp ? `:${i.followUp}` : ""}`);
    expect(kinds).toEqual(expect.arrayContaining(["interaction", "follow_up:set", "follow_up:done", "task", "change"]));
    expect(tl.find((i) => i.kind === "follow_up" && i.followUp === "set")).toMatchObject({ by: "teammate:abc", title: "Check the sample" });
    expect(tl.find((i) => i.kind === "task")?.who).toBe("Raka");
    // Newest first, and bounded.
    expect([...tl].sort((a, b) => b.at.localeCompare(a.at)).map((i) => i.at)).toEqual(tl.map((i) => i.at));
    expect(contactTimeline(businessId, id, 2)).toHaveLength(2);
  });
});

describe("teammate tools", () => {
  it("respect agent access and record changes as the teammate's", async () => {
    const { contactTools, CONTACT_TOOL_NAMES } = await import("../worker/contact-tools");
    const { setAgentAccess } = await import("@/lib/agent-access");
    const mate = db.insert(schema.teammates).values({ businessId, name: "Sinta", roleKey: "cs", title: "Support" }).returning().get();
    const person = add("Tool Person", { phone: "6281944445555" });
    const tools = contactTools({ businessId, teammate: { id: mate.id, name: mate.name }, taskId: "t1" });
    expect(tools.map((t) => t.name)).toEqual([...CONTACT_TOOL_NAMES]);
    const run = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(args, {}) as Promise<{ content: { text: string }[]; isError?: boolean }>;

    setAgentAccess(businessId, { contacts: "read" });
    expect((await run("log_interaction", { contact: person.id, kind: "call", text: "Hi" })).isError).toBe(true);
    expect((await run("contact_timeline", { contact: "Tool Person" })).isError).toBeFalsy();

    setAgentAccess(businessId, { contacts: "suggest" });
    expect((await run("log_interaction", { contact: "Tool Person", kind: "message", text: "Sent the catalog" })).isError).toBeFalsy();
    expect((await run("set_follow_up", { contact: person.id, date: "2030-01-02", note: "Ask for feedback" })).isError).toBeFalsy();
    const c = contacts.getContact(businessId, person.id)!;
    expect(c.followUpNote).toBe("Ask for feedback");
    expect(c.updatedBy).toBe(`teammate:${mate.id}`);
    expect(historyFor(businessId, "contact", person.id).every((h) => h.by === `teammate:${mate.id}`)).toBe(true);
    const tl = (await run("contact_timeline", { contact: person.id })).content[0].text;
    expect(tl).toContain("Sent the catalog");
    expect(tl).toContain("Follow-up set for 2030-01-02");
    expect((await run("set_follow_up", { contact: person.id, done: true })).isError).toBeFalsy();
    expect(contacts.getContact(businessId, person.id)?.followUpAt).toBeNull();
    expect((await run("list_segment", {})).content[0].text).toMatch(/segment/i);
  });
});

describe("segments", () => {
  it("saves to the folder's JSON and filters by kind, tags, words and follow-up", () => {
    add("Seg A", { kind: "supplier", tags: ["paper", "jakarta"], followUpAt: new Date(Date.now() - 1000) });
    add("Seg B", { kind: "supplier", tags: ["paper"], notes: "jakarta office" });
    add("Seg C", { kind: "customer", tags: ["paper", "jakarta"] });
    const r = saveSegment(businessId, { name: "Paper suppliers", kind: "supplier", tags: "paper", text: "jakarta" });
    if ("error" in r) throw new Error(r.error);
    expect(fs.existsSync(path.join(dir, "contact-segments.json"))).toBe(true);
    expect(segmentContacts(businessId, r.segment).map((c) => c.name)).toEqual(["Seg A", "Seg B"]);
    const due = saveSegment(businessId, { id: r.segment.id, name: "Paper suppliers due", kind: "supplier", tags: ["paper"], followUp: "due" });
    if ("error" in due) throw new Error(due.error);
    expect(listSegments(businessId)).toHaveLength(1);
    expect(segmentContacts(businessId, getSegment(businessId, "paper suppliers due")!).map((c) => c.name)).toEqual(["Seg A"]);
    expect(deleteSegment(businessId, r.segment.id)).toBe(true);
    expect(listSegments(businessId)).toHaveLength(0);
  });
});
