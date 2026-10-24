import { getAgentAccess, type AgentCollection } from "@/lib/agent-access";
import type { ObjectType } from "@/db/schema";

/**
 * What a teammate may change in the workspace (teammate tools in worker/tools.ts and
 * worker/workspace-tools.ts), on top of the per-collection level in src/lib/agent-access.ts:
 *
 *   read     look only: no creating, no changing, not even its own objects
 *   suggest  create its own objects and change them (and other teammates'); the owner's
 *            objects ("owner"/"system") are off limits: the tool says how to propose instead
 *   write    change anything
 *
 * Every allowed change is still recorded in object_history by the tool.
 */

export const teammateBy = (teammateId: string) => `teammate:${teammateId}`;

/** Which collection an object belongs to (tasks belong to none: always readable, never edited here). */
export function collectionOf(type: ObjectType): AgentCollection | null {
  switch (type) {
    case "doc":
    case "deliverable":
      return "docs";
    case "asset":
      return "library";
    case "contact":
      return "contacts";
    case "task":
      return null;
  }
}

const NAMES: Record<AgentCollection, string> = { docs: "docs", library: "the media library", contacts: "contacts" };

export type AccessDecision = { ok: true } | { ok: false; reason: string; /** The level is "suggest": a proposal is the way. */ suggest: boolean };

/** Made by the owner (or Ajudan itself) rather than a teammate. */
export const ownerMade = (createdBy: string | null | undefined) => !createdBy || !createdBy.startsWith("teammate:");

/** May this teammate create a new object in the collection? */
export function canCreate(businessId: string, collection: AgentCollection): AccessDecision {
  if (getAgentAccess(businessId)[collection] === "read") {
    return { ok: false, suggest: false, reason: `The owner lets the team only read ${NAMES[collection]}, not add to it. Mention what you'd add in your summary.` };
  }
  return { ok: true };
}

/**
 * May this teammate change an object made by `createdBy` ("owner", "system", "teammate:<id>")?
 * Its own and other teammates' objects need "suggest"; the owner's need "write".
 */
export function canChange(businessId: string, collection: AgentCollection, createdBy: string | null | undefined): AccessDecision {
  const level = getAgentAccess(businessId)[collection];
  if (level === "read") {
    return { ok: false, suggest: false, reason: `The owner lets the team only read ${NAMES[collection]}. Mention the change in your summary instead.` };
  }
  if (level === "write" || !ownerMade(createdBy)) return { ok: true };
  return { ok: false, suggest: true, reason: `That's the owner's, and the team may only suggest changes to the owner's ${NAMES[collection]}.` };
}
