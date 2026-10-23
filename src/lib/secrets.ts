import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { dataDir } from "@/lib/paths";

/**
 * Credentials the team may use (API keys, tokens). The value goes to the macOS
 * Keychain (service "Ajudan <businessId>"), never into the database, chats or the
 * business folder; the secrets table only keeps its name, the hosts it may be sent to
 * and a note. Teammates write {{secret.NAME}} in an http_request and the worker fills
 * it in, only for those hosts (worker/tools.ts). On other systems the value goes to
 * <folder>/.secrets.json (readable only by you).
 */

const run = promisify(execFile);
const KEYCHAIN = process.platform === "darwin" && fs.existsSync("/usr/bin/security");

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,47}$/;
export const PLACEHOLDER = /\{\{\s*secret\.([A-Z][A-Z0-9_]{1,47})\s*\}\}/g;

const service = (businessId: string) => `Ajudan ${businessId}`;
const fileStore = () => path.join(dataDir(), ".secrets.json");

function readFileStore(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(fileStore(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** "orucraft.com/api" or "https://api.x.com" → "orucraft.com", "api.x.com". */
export function normalizeHost(raw: string) {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname.replace(/^\*\./, "") || null;
  } catch {
    return null;
  }
}

/** The host matches one of the allowed hosts (or is a subdomain of one). */
export function hostAllowed(host: string, hosts: string[]) {
  const h = host.toLowerCase();
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

export function listSecrets(businessId: string) {
  return db.select().from(schema.secrets).where(eq(schema.secrets.businessId, businessId)).all();
}

export function findSecret(businessId: string, name: string) {
  return db
    .select()
    .from(schema.secrets)
    .where(and(eq(schema.secrets.businessId, businessId), eq(schema.secrets.name, name)))
    .get();
}

export async function setSecret(p: { businessId: string; name: string; value: string; hosts: string[]; note?: string }) {
  const name = p.name.trim().toUpperCase();
  if (!SECRET_NAME.test(name)) throw new Error("Use a name like ORUCRAFT_API (capital letters, digits, _).");
  const value = p.value.trim();
  if (!value) throw new Error("The value is empty.");
  const hosts = [...new Set(p.hosts.map(normalizeHost).filter((h): h is string => !!h))];
  if (!hosts.length) throw new Error("Add at least one host it may be sent to, e.g. orucraft.com.");
  if (KEYCHAIN) {
    // -U updates an existing item. The value is passed as an argument to Apple's own
    // `security` tool (not a shell), which then owns the item: no Keychain prompts.
    await run("/usr/bin/security", ["add-generic-password", "-U", "-s", service(p.businessId), "-a", name, "-l", `Ajudan: ${name}`, "-w", value]);
  } else {
    const store = readFileStore();
    store[name] = value;
    fs.writeFileSync(fileStore(), JSON.stringify(store, null, 2), { mode: 0o600 });
  }
  const existing = findSecret(p.businessId, name);
  if (existing) {
    db.update(schema.secrets).set({ hosts, note: p.note ?? existing.note }).where(eq(schema.secrets.id, existing.id)).run();
  } else {
    db.insert(schema.secrets).values({ businessId: p.businessId, name, hosts, note: p.note ?? "" }).run();
  }
  return name;
}

export async function secretValue(businessId: string, name: string) {
  if (!KEYCHAIN) return readFileStore()[name] ?? null;
  try {
    const { stdout } = await run("/usr/bin/security", ["find-generic-password", "-s", service(businessId), "-a", name, "-w"]);
    return stdout.replace(/\n$/, "");
  } catch {
    return null;
  }
}

export async function deleteSecret(businessId: string, name: string) {
  if (KEYCHAIN) {
    await run("/usr/bin/security", ["delete-generic-password", "-s", service(businessId), "-a", name]).catch(() => {});
  } else {
    const store = readFileStore();
    delete store[name];
    fs.writeFileSync(fileStore(), JSON.stringify(store, null, 2), { mode: 0o600 });
  }
  db.delete(schema.secrets).where(and(eq(schema.secrets.businessId, businessId), eq(schema.secrets.name, name))).run();
}

/** Replace every secret value in text with [secret NAME] (responses, errors, logs). */
export function redact(text: string, values: Map<string, string>) {
  let out = text;
  for (const [name, v] of values) if (v.length >= 4) out = out.split(v).join(`[secret ${name}]`);
  return out;
}

/**
 * The AI backend's API key (src/lib/backend.ts), stored like a secret but outside the
 * secrets table: teammates can't list it, and its lowercase name never matches {{secret.NAME}}.
 */
export const BACKEND_KEY = "ajudan-backend-key";

export async function setBackendKey(businessId: string, value: string) {
  const v = value.trim();
  if (!v) return;
  if (KEYCHAIN) {
    await run("/usr/bin/security", ["add-generic-password", "-U", "-s", service(businessId), "-a", BACKEND_KEY, "-l", "Ajudan: AI backend key", "-w", v]);
  } else {
    const store = readFileStore();
    store[BACKEND_KEY] = v;
    fs.writeFileSync(fileStore(), JSON.stringify(store, null, 2), { mode: 0o600 });
  }
}

export const backendKey = (businessId: string) => secretValue(businessId, BACKEND_KEY);
