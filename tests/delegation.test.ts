import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-delegation-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { delegationDepth, MAX_DELEGATION_DEPTH } = await import("@/lib/tasks");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let businessId: string;
let teammateId: string;
const task = (parentTaskId: string | null = null) =>
  db.insert(schema.tasks).values({ businessId, teammateId, title: "t", instructions: "t", parentTaskId }).returning().get().id;

beforeEach(() => {
  db.delete(schema.businesses).run();
  businessId = db.insert(schema.businesses).values({ name: "Test" }).returning().get().id;
  teammateId = db.insert(schema.teammates).values({ businessId, name: "Raka", roleKey: "copywriter", title: "Copywriter" }).returning().get().id;
});

describe("delegationDepth", () => {
  it("counts hops up the parentTaskId chain", () => {
    const root = task();
    const child = task(root);
    const grandchild = task(child);
    expect(delegationDepth(root)).toBe(0);
    expect(delegationDepth(child)).toBe(1);
    expect(delegationDepth(grandchild)).toBe(2);
    expect(MAX_DELEGATION_DEPTH).toBe(2);
    // The grandchild may not hand on again; the child still may.
    expect(delegationDepth(grandchild) + 1 > MAX_DELEGATION_DEPTH).toBe(true);
    expect(delegationDepth(child) + 1 > MAX_DELEGATION_DEPTH).toBe(false);
  });

  it("survives a missing parent and a cycle", () => {
    const orphan = task("gone");
    expect(delegationDepth(orphan)).toBe(1);
    const a = task();
    const b = task(a);
    db.update(schema.tasks).set({ parentTaskId: b }).where(eq(schema.tasks.id, a)).run();
    expect(delegationDepth(b)).toBe(2);
    expect(delegationDepth("missing")).toBe(0);
  });
});
