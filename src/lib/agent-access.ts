import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * What teammates may do in each workspace collection (businesses.agent_access):
 *   read     look only
 *   suggest  read, create their own objects, and propose changes to the owner's (the owner decides)
 *   write    change anything directly (every change still goes into object_history)
 */

export type AgentCollection = "docs" | "library" | "contacts";
export type AccessLevel = "read" | "suggest" | "write";
export type AgentAccess = Record<AgentCollection, AccessLevel>;

export const AGENT_COLLECTIONS: AgentCollection[] = ["docs", "library", "contacts"];
export const ACCESS_LEVELS: AccessLevel[] = ["read", "suggest", "write"];

/** Docs and contacts are the owner's words and relationships: suggest. Library labels are low-stakes: write. */
export const DEFAULT_AGENT_ACCESS: AgentAccess = { docs: "suggest", library: "write", contacts: "suggest" };

const RANK: Record<AccessLevel, number> = { read: 0, suggest: 1, write: 2 };

const isLevel = (v: unknown): v is AccessLevel => typeof v === "string" && (ACCESS_LEVELS as string[]).includes(v);

/** The business's access per collection, defaults filled in. */
export function getAgentAccess(businessId: string): AgentAccess {
  const stored = db.select({ a: schema.businesses.agentAccess }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.a ?? {};
  const out = { ...DEFAULT_AGENT_ACCESS };
  for (const c of AGENT_COLLECTIONS) if (isLevel(stored[c])) out[c] = stored[c];
  return out;
}

/** Change some collections' access; others keep theirs. Returns the result. */
export function setAgentAccess(businessId: string, patch: Partial<AgentAccess>): AgentAccess {
  const next = { ...getAgentAccess(businessId) };
  for (const c of AGENT_COLLECTIONS) if (isLevel(patch[c])) next[c] = patch[c];
  db.update(schema.businesses).set({ agentAccess: next }).where(eq(schema.businesses.id, businessId)).run();
  return next;
}

/** Whether teammates have at least `need` in this collection. */
export function canAgent(businessId: string, collection: AgentCollection, need: AccessLevel) {
  return RANK[getAgentAccess(businessId)[collection]] >= RANK[need];
}
