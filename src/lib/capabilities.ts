import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Approval, Teammate } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { normalizeHost, setSecret } from "@/lib/secrets";
import { createTask } from "@/lib/tasks";

/**
 * When a teammate hits something it can't do (no API key, no shell, a site that isn't
 * allowed), it asks for the ability with request_capability instead of giving up. The
 * request waits on the Approvals page (an approvals row with toolName CAPABILITY);
 * approving it switches the ability on and gives the teammate a task to carry on.
 */

export const CAPABILITY = "capability";

export type CapabilityRequest =
  | { kind: "secret"; name: string; hosts: string[]; why: string }
  | { kind: "shell"; why: string }
  | { kind: "domain"; domain: string; why: string }
  | { kind: "browser"; why: string }
  | { kind: "browser_site"; site: string; why: string }
  | { kind: "whatsapp"; why: string }
  | { kind: "repos"; why: string };

export function describeCapability(who: string, r: CapabilityRequest) {
  switch (r.kind) {
    case "secret":
      return `${who} needs a credential, ${r.name}, for ${r.hosts.join(", ")}`;
    case "shell":
      return `${who} wants to run commands (sandboxed: its own folder and allowed domains only)`;
    case "domain":
      return `${who} wants its commands to reach ${r.domain}`;
    case "browser":
      return `${who} wants to use the business browser`;
    case "browser_site":
      return `${who} wants to open ${r.site} in the business browser`;
    case "whatsapp":
      return `${who} wants to use WhatsApp`;
    case "repos":
      return `${who} wants to read the connected code repositories and use their GitHub issues`;
  }
}

/** Same request already waiting? (Teammates retry; one card is enough.) */
function pendingSame(teammateId: string, r: CapabilityRequest) {
  const key = JSON.stringify(r, ["kind", "name", "domain", "site"]);
  return db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.teammateId, teammateId), eq(schema.approvals.toolName, CAPABILITY), eq(schema.approvals.status, "pending")))
    .all()
    .find((a) => JSON.stringify(a.input, ["kind", "name", "domain", "site"]) === key);
}

export function requestCapability(p: { businessId: string; teammate: Pick<Teammate, "id" | "name">; taskId: string; request: CapabilityRequest }) {
  const existing = pendingSame(p.teammate.id, p.request);
  if (existing) return { approval: existing, duplicate: true };
  const summary = describeCapability(p.teammate.name, p.request);
  const approval = db
    .insert(schema.approvals)
    .values({ businessId: p.businessId, teammateId: p.teammate.id, taskId: p.taskId, toolName: CAPABILITY, input: p.request, summary })
    .returning()
    .get();
  logEvent({ businessId: p.businessId, teammateId: p.teammate.id, taskId: p.taskId, type: "approval_requested", message: summary, data: { approvalId: approval.id, toolName: CAPABILITY } });
  return { approval, duplicate: false };
}

/**
 * The owner approved: switch the ability on, then give the teammate a task to carry
 * on with the work that needed it. `secretValue` comes from the approval form.
 */
export async function grantCapability(approval: Approval, opts: { secretValue?: string; note?: string | null }) {
  const r = approval.input as CapabilityRequest;
  const teammate = db.select().from(schema.teammates).where(eq(schema.teammates.id, approval.teammateId)).get();
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.id, approval.businessId)).get();
  if (!teammate || !business) throw new Error("Teammate or business not found");
  const setMate = (v: Partial<Teammate>) => db.update(schema.teammates).set(v).where(eq(schema.teammates.id, teammate.id)).run();

  let granted: string;
  switch (r.kind) {
    case "secret": {
      if (!opts.secretValue?.trim()) throw new Error(`Paste the value of ${r.name} first.`);
      const name = await setSecret({ businessId: business.id, name: r.name, value: opts.secretValue, hosts: r.hosts, note: r.why });
      granted = `the credential ${name} (use {{secret.${name}}} in http_request; it is only sent to ${r.hosts.join(", ")})`;
      break;
    }
    case "shell":
      setMate({ shellAccess: true });
      granted = "running commands in your sandboxed shell (Bash)";
      break;
    case "domain": {
      const d = normalizeHost(r.domain);
      if (!d) throw new Error(`"${r.domain}" isn't a domain`);
      db.update(schema.businesses).set({ networkDomains: [...new Set([...business.networkDomains, d])] }).where(eq(schema.businesses.id, business.id)).run();
      granted = `network access to ${d} from your shell`;
      break;
    }
    case "browser":
      setMate({ browserAccess: true });
      granted = "the business browser";
      break;
    case "browser_site": {
      const d = normalizeHost(r.site);
      if (!d) throw new Error(`"${r.site}" isn't a site`);
      db.update(schema.businesses).set({ browserSites: [...new Set([...business.browserSites, d])] }).where(eq(schema.businesses.id, business.id)).run();
      granted = `opening ${d} in the business browser`;
      break;
    }
    case "whatsapp":
      setMate({ whatsappAccess: true });
      granted = "WhatsApp";
      break;
    case "repos":
      setMate({ repoAccess: true });
      granted = "the connected code repositories (read-only) and their GitHub issues (list_repos)";
      break;
  }

  const original = approval.taskId ? db.select().from(schema.tasks).where(eq(schema.tasks.id, approval.taskId)).get() : undefined;
  createTask({
    businessId: business.id,
    teammateId: teammate.id,
    title: `Go ahead: ${original?.title ?? "your request"}`.slice(0, 80),
    createdBy: "system:capability",
    // Stays part of the owner's request, so the manager reports the result.
    parentTaskId: original?.parentTaskId ?? null,
    attachments: original?.attachments ?? [],
    // Carries on in the conversation that asked (if its session still exists).
    sessionId: original?.sessionId ?? null,
    instructions: `The owner approved your request: you now have ${granted}.${opts.note ? ` Their note: "${opts.note}"` : ""}\n\nCarry on with the work that needed it${original ? `:\n\n> ${original.instructions.slice(0, 3000).replace(/\n/g, "\n> ")}` : "."}`,
  });
  return granted;
}
