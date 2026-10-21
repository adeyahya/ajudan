/**
 * One-time move from the old shared ./data folder to one-folder-per-business.
 *
 *   npx tsx scripts/move-to-folder.ts <businessId> [targetFolder]
 *
 * Copies (never deletes) the business's database rows, teammate workspaces and
 * browser profile into the target folder (default ~/Ajudan/<name>), exports its
 * deliverables to work/*.md and opens it. ./data is left as it was.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isBusinessFolder, setActiveFolder, slugify, suggestFolder } from "@/lib/folders";
import { pinDataDir } from "@/lib/paths";
import { syncDeliverableFile } from "@/lib/workfiles";

const LEGACY = path.resolve("data");
const [businessId, targetArg] = process.argv.slice(2);

async function closeLegacyBrowser(profile: string) {
  try {
    const port = Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
    const v = (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).json()) as {
      webSocketDebuggerUrl: string;
    };
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      ws.onmessage = () => resolve();
      ws.onerror = () => resolve();
      setTimeout(resolve, 2000);
    });
    await new Promise((r) => setTimeout(r, 1500)); // let Chrome flush the profile
    console.log("closed the business browser so its profile can be copied");
  } catch {
    // not running
  }
}

async function main() {
  if (!businessId) throw new Error("usage: tsx scripts/move-to-folder.ts <businessId> [targetFolder]");
  const src = new Database(path.join(LEGACY, "ajudan.db"), { readonly: true });
  const biz = src.prepare("select id, name from businesses where id = ?").get(businessId) as
    | { id: string; name: string }
    | undefined;
  if (!biz) throw new Error(`No business ${businessId} in ${LEGACY}/ajudan.db`);
  const target = path.resolve(targetArg ?? suggestFolder(biz.name));
  if (isBusinessFolder(target)) throw new Error(`${target} already holds a business`);
  fs.mkdirSync(target, { recursive: true });
  console.log(`moving "${biz.name}" → ${target}`);

  // 1. Database: a consistent copy, then drop any other businesses (cascades their rows).
  src.prepare("VACUUM INTO ?").run(path.join(target, "ajudan.db"));
  src.close();
  pinDataDir(target);
  const db = getDb(target); // applies migrations, foreign keys on
  db.delete(schema.businesses).where(ne(schema.businesses.id, businessId)).run();

  // 2. Teammate workspaces → teammates/<name>/ (relative paths).
  const used = new Set<string>();
  for (const t of db.select().from(schema.teammates).all()) {
    let slug = slugify(t.name);
    for (let i = 2; used.has(slug); i++) slug = `${slugify(t.name)}-${i}`;
    used.add(slug);
    const rel = path.join("teammates", slug);
    const from = t.workspaceDir && path.isAbsolute(t.workspaceDir) ? t.workspaceDir : path.join(LEGACY, "workspaces", businessId, t.id);
    const to = path.join(target, rel);
    if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
    else fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, ".teammate-id"), t.id);
    db.update(schema.teammates).set({ workspaceDir: rel }).where(eq(schema.teammates.id, t.id)).run();
    console.log(`  teammate ${t.name} → ${rel}`);
  }
  const interview = path.join(LEGACY, "workspaces", businessId, "_onboarding");
  if (fs.existsSync(interview)) fs.cpSync(interview, path.join(target, "interview"), { recursive: true });

  // 3. Browser profile (logins) → browser/.
  const profile = path.join(LEGACY, "browsers", businessId);
  if (fs.existsSync(profile)) {
    await closeLegacyBrowser(profile);
    fs.cpSync(profile, path.join(target, "browser"), { recursive: true });
    fs.rmSync(path.join(target, "browser", "DevToolsActivePort"), { force: true });
    console.log("  browser profile → browser/");
  }

  // 4. Work as files.
  const ds = db.select({ id: schema.deliverables.id }).from(schema.deliverables).all();
  for (const d of ds) syncDeliverableFile(d.id);
  console.log(`  ${ds.length} deliverables → work/`);

  setActiveFolder(target);
  console.log(`done. "${biz.name}" is now the open business. ${LEGACY} was left untouched.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
