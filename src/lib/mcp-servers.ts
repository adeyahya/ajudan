import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { McpServer, Teammate } from "@/db/schema";
import { PLACEHOLDER, findSecret, hostAllowed, normalizeHost, secretValue } from "@/lib/secrets";

/**
 * Extra tool servers (MCP) for teammates. A teammate asks for one with
 * request_capability(kind "mcp"); the owner sees the exact command or URL on the
 * Approvals page, and approving adds the server here and gives that teammate access
 * (teammates.mcpAccess). Its tools appear as mcp__<name>__<tool> in the teammate's runs.
 *
 * Credentials never sit in the row: env and header values are plain text or
 * {{secret.NAME}}, filled in from the Keychain when a run starts.
 */

/** Names the worker's own servers use (biz, whatsapp, github, browser): never shadowed. */
export const RESERVED_MCP_NAMES = new Set(["biz", "whatsapp", "github", "browser"]);
/** Lowercase, single underscores: tool names are mcp__<name>__<tool>, so no "__" or "-" inside. */
export const MCP_NAME = /^(?=.{2,32}$)[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export type McpSpec = {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

export function listMcpServers(businessId: string): McpServer[] {
  return db.select().from(schema.mcpServers).where(eq(schema.mcpServers.businessId, businessId)).all();
}

export function findMcpServer(businessId: string, name: string) {
  return db
    .select()
    .from(schema.mcpServers)
    .where(and(eq(schema.mcpServers.businessId, businessId), eq(schema.mcpServers.name, name)))
    .get();
}

/** The secret names a spec's env and headers refer to. */
export function specSecrets(spec: Pick<McpSpec, "env" | "headers">) {
  const names = new Set<string>();
  for (const v of [...Object.values(spec.env ?? {}), ...Object.values(spec.headers ?? {})]) {
    for (const m of v.matchAll(PLACEHOLDER)) names.add(m[1]);
  }
  return [...names];
}

/** Looks like a pasted key rather than a setting: long, no spaces, mixed letters and digits. */
const RAW_CREDENTIAL = /^(?:Bearer\s+)?(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9_\-.:/+=]{24,}$/;

/** Checks a requested server; returns what's wrong, for the teammate. */
export function checkMcpSpec(spec: McpSpec): string | null {
  if (!MCP_NAME.test(spec.name)) return "Name the server with a short lowercase slug, e.g. \"notion\" or \"postgres\".";
  if (RESERVED_MCP_NAMES.has(spec.name)) return `"${spec.name}" is taken by Ajudan's own tools; pick another name.`;
  if (spec.transport === "stdio") {
    if (!spec.command?.trim()) return "A stdio server needs the command that starts it, e.g. command \"npx\", args [\"-y\", \"@notionhq/notion-mcp-server\"].";
  } else {
    let u: URL;
    try {
      u = new URL(spec.url ?? "");
    } catch {
      return "An http server needs its full URL, e.g. https://mcp.notion.com/mcp.";
    }
    if (u.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return "Use an https:// URL (plain http only for localhost).";
  }
  for (const [k, v] of Object.entries({ ...spec.env, ...spec.headers })) {
    const literal = v.replace(PLACEHOLDER, "").trim();
    if (literal && RAW_CREDENTIAL.test(literal)) {
      return `${k} looks like a credential. Never put keys in the request: write {{secret.NAME}} instead, and ask for the secret with request_capability(kind "secret").`;
    }
  }
  return null;
}

/** One line for the owner: exactly what runs or where it connects, and which credentials it gets. */
export function describeMcpSpec(spec: McpSpec) {
  const where =
    spec.transport === "stdio"
      ? `runs \`${[spec.command, ...(spec.args ?? [])].join(" ")}\` on this computer (outside the sandbox)`
      : `connects to ${spec.url}`;
  const secrets = specSecrets(spec);
  return `${where}${secrets.length ? `, with the credential${secrets.length > 1 ? "s" : ""} ${secrets.join(", ")}` : ""}`;
}

/** Credentials the spec needs that aren't stored, or that may not be sent to its host. */
export function missingMcpSecrets(businessId: string, spec: McpSpec) {
  const host = spec.transport === "http" && spec.url ? normalizeHost(spec.url) : null;
  return specSecrets(spec).filter((name) => {
    const s = findSecret(businessId, name);
    if (!s) return true;
    // Sent over the network in a header: only to a host the secret allows.
    return host != null && specSecrets({ headers: spec.headers }).includes(name) && !hostAllowed(host, s.hosts);
  });
}

/** Adds the server (or updates it with the newly approved spec). */
export function saveMcpServer(businessId: string, spec: McpSpec, note: string) {
  const values = {
    transport: spec.transport,
    command: spec.transport === "stdio" ? spec.command!.trim() : null,
    args: spec.transport === "stdio" ? (spec.args ?? []) : [],
    url: spec.transport === "http" ? spec.url! : null,
    env: spec.env ?? {},
    headers: spec.headers ?? {},
    note,
  };
  const existing = findMcpServer(businessId, spec.name);
  if (existing) return db.update(schema.mcpServers).set(values).where(eq(schema.mcpServers.id, existing.id)).returning().get();
  return db
    .insert(schema.mcpServers)
    .values({ businessId, name: spec.name, ...values })
    .returning()
    .get();
}

export function grantMcpAccess(teammate: Pick<Teammate, "id" | "mcpAccess">, name: string) {
  const mcpAccess = [...new Set([...teammate.mcpAccess, name])];
  db.update(schema.teammates).set({ mcpAccess }).where(eq(schema.teammates.id, teammate.id)).run();
}

export function revokeMcpAccess(businessId: string, teammateId: string, name: string) {
  const mate = db.select().from(schema.teammates).where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId))).get();
  if (!mate) return;
  db.update(schema.teammates)
    .set({ mcpAccess: mate.mcpAccess.filter((n) => n !== name) })
    .where(eq(schema.teammates.id, mate.id))
    .run();
}

export function setMcpTrusted(businessId: string, id: string, trusted: boolean) {
  db.update(schema.mcpServers)
    .set({ trusted })
    .where(and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.businessId, businessId)))
    .run();
}

/** Removes the server and every teammate's access to it. */
export function removeMcpServer(businessId: string, id: string) {
  const server = db.select().from(schema.mcpServers).where(and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.businessId, businessId))).get();
  if (!server) return null;
  for (const m of db.select().from(schema.teammates).where(eq(schema.teammates.businessId, businessId)).all()) {
    if (m.mcpAccess.includes(server.name)) revokeMcpAccess(businessId, m.id, server.name);
  }
  db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, server.id)).run();
  return server;
}

/** {{secret.NAME}} → the stored value; a missing secret leaves the run without that server. */
async function fill(businessId: string, values: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    let filled = v;
    for (const m of v.matchAll(PLACEHOLDER)) {
      const secret = await secretValue(businessId, m[1]);
      if (secret == null) throw new Error(`the credential ${m[1]} isn't stored`);
      filled = filled.split(m[0]).join(secret);
    }
    out[k] = filled;
  }
  return out;
}

/**
 * The teammate's servers as runAgent configs, credentials filled in. A server that can't
 * be set up (a credential gone, removed meanwhile) is left out and reported in `skipped`.
 */
export async function teammateMcpConfigs(businessId: string, teammate: Pick<Teammate, "mcpAccess">) {
  const configs: Record<string, McpServerConfig> = {};
  const servers: McpServer[] = [];
  const skipped: string[] = [];
  for (const name of teammate.mcpAccess) {
    const s = findMcpServer(businessId, name);
    if (!s || RESERVED_MCP_NAMES.has(s.name)) continue;
    try {
      configs[s.name] =
        s.transport === "stdio"
          ? { type: "stdio", command: s.command ?? "", args: s.args, env: await fill(businessId, s.env) }
          : { type: "http", url: s.url ?? "", headers: await fill(businessId, s.headers) };
      servers.push(s);
    } catch (err) {
      skipped.push(`${s.name}: ${(err as Error).message}`);
    }
  }
  return { configs, servers, skipped };
}
