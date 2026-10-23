import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Repository } from "@/db/schema";
import { dataDir } from "@/lib/paths";

/**
 * Code repositories the owner connected: local git working trees that teammates with
 * repoAccess may read (never write), and whose GitHub issues they use through the
 * owner's own `gh` login. gh and git run in the worker or the web app, never in a
 * teammate's sandbox, so the GitHub token never reaches a prompt or a file.
 */

const exec = promisify(execFile);

/** Runs a command and returns stdout (swapped out in tests). */
export type Runner = (cmd: string, args: string[], cwd?: string) => Promise<string>;

export const execRunner: Runner = async (cmd, args, cwd) =>
  (await exec(cmd, args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 60_000, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } })).stdout;

/** "owner/name" from an origin remote on github.com (ssh or https), else null. */
export function parseGithubRemote(url: string) {
  const m = url.trim().match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/(?:[^@/]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export type RepoInfo = { path: string; name: string; githubRepo: string | null };
/** Why a folder can't be connected (the Repositories tab says it in the owner's language). */
export type RepoError = "missing" | "not_git" | "business_folder";

/** Check a folder is a git working tree (outside the business folder) and read its GitHub remote. */
export async function inspectRepo(dir: string, run: Runner = execRunner): Promise<RepoInfo | { error: RepoError }> {
  const abs = path.resolve(dir.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  if (!dir.trim() || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { error: "missing" };
  let top: string;
  try {
    top = fs.realpathSync((await run("git", ["-C", abs, "rev-parse", "--show-toplevel"])).trim());
  } catch {
    return { error: "not_git" };
  }
  const data = fs.realpathSync(dataDir());
  if (top === data || top.startsWith(data + path.sep) || data.startsWith(top + path.sep)) {
    return { error: "business_folder" };
  }
  const origin = await run("git", ["-C", top, "remote", "get-url", "origin"]).catch(() => "");
  return { path: top, name: path.basename(top), githubRepo: parseGithubRemote(origin) };
}

export function listRepos(businessId: string): Repository[] {
  return db.select().from(schema.repositories).where(eq(schema.repositories.businessId, businessId)).orderBy(asc(schema.repositories.name)).all();
}

/** Connect a repository (a folder already connected just comes back). */
export async function connectRepo(businessId: string, dir: string, run: Runner = execRunner): Promise<{ repo: Repository } | { error: RepoError }> {
  const info = await inspectRepo(dir, run);
  if ("error" in info) return info;
  const repos = listRepos(businessId);
  const same = repos.find((r) => r.path === info.path);
  if (same) return { repo: same };
  const taken = new Set(repos.map((r) => r.name.toLowerCase()));
  let name = info.name;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${info.name}-${n}`;
  const repo = db.insert(schema.repositories).values({ businessId, name, path: info.path, githubRepo: info.githubRepo }).returning().get();
  return { repo };
}

export function disconnectRepo(businessId: string, id: string) {
  db.delete(schema.repositories).where(and(eq(schema.repositories.businessId, businessId), eq(schema.repositories.id, id))).run();
}

/** The connected repository a teammate names (its name, or its GitHub owner/name). */
export function resolveRepo(businessId: string, name: string): Repository | { error: string } {
  const repos = listRepos(businessId);
  const n = name.trim().toLowerCase();
  const repo = repos.find((r) => r.name.toLowerCase() === n) ?? repos.find((r) => r.githubRepo?.toLowerCase() === n);
  if (repo) return repo;
  return {
    error: repos.length
      ? `No connected repository called "${name}". Connected: ${repos.map((r) => r.name).join(", ")}.`
      : "No repositories are connected. The owner connects them on Business → Repositories.",
  };
}

/** Short timeout: the Repositories tab shouldn't hang when offline. */
const quickRunner: Runner = async (cmd, args, cwd) => (await exec(cmd, args, { cwd, timeout: 8_000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } })).stdout;

/** Is gh installed and signed in? (Shown on the Repositories tab.) */
export async function ghStatus(run: Runner = quickRunner): Promise<{ ok: true; account: string } | { ok: false; reason: "missing" | "signed_out" }> {
  try {
    const login = (await run("gh", ["api", "user", "--jq", ".login"])).trim();
    return login ? { ok: true, account: login } : { ok: false, reason: "signed_out" };
  } catch (err) {
    return { ok: false, reason: (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "signed_out" };
  }
}

function needsGithub(repo: Repository) {
  if (!repo.githubRepo) throw new Error(`${repo.name} has no GitHub remote (origin), so it has no GitHub issues.`);
  return repo.githubRepo;
}

/** Recent commits, newest first (optionally only those touching one path). */
export async function gitLog(repo: Repository, opts: { limit?: number; path?: string } = {}, run: Runner = execRunner) {
  const args = ["-C", repo.path, "log", `-n${Math.min(Math.max(opts.limit ?? 30, 1), 200)}`, "--date=short", "--pretty=format:%h %ad %an: %s"];
  if (opts.path) args.push("--", opts.path);
  return (await run("git", args)).trim() || "(no commits)";
}

export type IssueSummary = { number: number; title: string; state: string; labels: string[]; url: string; updatedAt: string };

export async function listIssues(
  repo: Repository,
  opts: { state?: "open" | "closed" | "all"; search?: string; labels?: string[]; limit?: number } = {},
  run: Runner = execRunner,
): Promise<IssueSummary[]> {
  const args = ["issue", "list", "-R", needsGithub(repo), "--state", opts.state ?? "open", "--limit", String(Math.min(opts.limit ?? 50, 200)), "--json", "number,title,state,labels,url,updatedAt"];
  if (opts.search) args.push("--search", opts.search);
  for (const l of opts.labels ?? []) args.push("--label", l);
  const rows = JSON.parse(await run("gh", args, repo.path)) as (Omit<IssueSummary, "labels"> & { labels: { name: string }[] })[];
  return rows.map((r) => ({ ...r, labels: r.labels.map((l) => l.name) }));
}

export async function viewIssue(repo: Repository, number: number, run: Runner = execRunner) {
  const out = await run("gh", ["issue", "view", String(number), "-R", needsGithub(repo), "--comments", "--json", "number,title,state,body,labels,url,author,comments"], repo.path);
  return JSON.parse(out) as Record<string, unknown>;
}

export async function listLabels(repo: Repository, run: Runner = execRunner) {
  const out = await run("gh", ["label", "list", "-R", needsGithub(repo), "--limit", "200", "--json", "name,description"], repo.path);
  return JSON.parse(out) as { name: string; description: string }[];
}

export type NewIssue = { title: string; body: string; labels?: string[] };

/**
 * Open several issues (a backlog) in one go. Labels the repository doesn't have are left
 * off (gh refuses unknown labels) and reported; one failing issue doesn't stop the rest.
 */
export async function createIssues(repo: Repository, issues: NewIssue[], run: Runner = execRunner) {
  const slug = needsGithub(repo);
  const known = new Map((await listLabels(repo, run)).map((l) => [l.name.toLowerCase(), l.name]));
  const created: { title: string; url: string }[] = [];
  const failed: { title: string; error: string }[] = [];
  const dropped = new Set<string>();
  for (const issue of issues) {
    const args = ["issue", "create", "-R", slug, "--title", issue.title, "--body", issue.body || " "];
    for (const l of issue.labels ?? []) {
      const name = known.get(l.toLowerCase());
      if (name) args.push("--label", name);
      else dropped.add(l);
    }
    try {
      created.push({ title: issue.title, url: (await run("gh", args, repo.path)).trim().split("\n").pop() ?? "" });
    } catch (err) {
      failed.push({ title: issue.title, error: ghError(err) });
    }
  }
  return { created, failed, droppedLabels: [...dropped] };
}

export async function commentIssue(repo: Repository, number: number, body: string, run: Runner = execRunner) {
  return (await run("gh", ["issue", "comment", String(number), "-R", needsGithub(repo), "--body", body], repo.path)).trim();
}

/** gh's own message (stderr) rather than "Command failed: gh …". */
export function ghError(err: unknown) {
  const e = err as { stderr?: string; message?: string };
  return (e.stderr?.trim() || e.message || String(err)).split("\n").slice(0, 3).join(" ").slice(0, 300);
}
