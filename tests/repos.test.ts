import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-repos-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const repos = await import("@/lib/repos");
const { checkFileAccess, isSecretPath } = await import("../worker/handlers/task");
const { sameBacklog } = await import("../worker/github-tools");

const code = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-code-")));
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(code, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
let businessId: string;

beforeAll(() => {
  businessId = db.insert(schema.businesses).values({ name: "Test" }).returning().get().id;
  fs.mkdirSync(path.join(code, "shop", "src"), { recursive: true });
  git(path.join(code, "shop"), "init", "-q");
  git(path.join(code, "shop"), "remote", "add", "origin", "git@github.com:acme/shop.git");
  fs.mkdirSync(path.join(code, "tool"));
  git(path.join(code, "tool"), "init", "-q");
  fs.mkdirSync(path.join(code, "plain"));
});

describe("parseGithubRemote", () => {
  it("reads ssh and https remotes on github.com only", () => {
    expect(repos.parseGithubRemote("git@github.com:acme/shop.git")).toBe("acme/shop");
    expect(repos.parseGithubRemote("https://github.com/acme/shop")).toBe("acme/shop");
    expect(repos.parseGithubRemote("https://token@github.com/acme/my.repo.git\n")).toBe("acme/my.repo");
    expect(repos.parseGithubRemote("ssh://git@github.com/acme/shop.git")).toBe("acme/shop");
    expect(repos.parseGithubRemote("git@gitlab.com:acme/shop.git")).toBeNull();
    expect(repos.parseGithubRemote("")).toBeNull();
  });
});

describe("connecting repositories", () => {
  it("connects the top of a working tree, with its GitHub repo", async () => {
    const r = await repos.connectRepo(businessId, path.join(code, "shop", "src"));
    expect(r).toMatchObject({ repo: { name: "shop", path: path.join(code, "shop"), githubRepo: "acme/shop" } });
    // The same folder again comes back, not a second row.
    await repos.connectRepo(businessId, path.join(code, "shop"));
    expect(repos.listRepos(businessId)).toHaveLength(1);
  });

  it("connects a repository without a GitHub remote, and refuses non-repos and the business folder", async () => {
    expect(await repos.connectRepo(businessId, path.join(code, "tool"))).toMatchObject({ repo: { githubRepo: null } });
    expect(await repos.connectRepo(businessId, path.join(code, "plain"))).toEqual({ error: "not_git" });
    expect(await repos.connectRepo(businessId, path.join(code, "nope"))).toEqual({ error: "missing" });
    git(dir, "init", "-q");
    expect(await repos.connectRepo(businessId, dir)).toEqual({ error: "business_folder" });
  });

  it("resolves only connected repositories, by name or GitHub repo", () => {
    expect(repos.resolveRepo(businessId, "SHOP")).toMatchObject({ name: "shop" });
    expect(repos.resolveRepo(businessId, "acme/shop")).toMatchObject({ name: "shop" });
    expect(repos.resolveRepo(businessId, "acme/other")).toMatchObject({ error: expect.stringContaining("Connected: shop, tool") });
  });
});

describe("GitHub issues", () => {
  const shop = () => repos.resolveRepo(businessId, "shop") as Exclude<ReturnType<typeof repos.resolveRepo>, { error: string }>;

  it("opens each issue with known labels only and reports failures", async () => {
    const calls: string[][] = [];
    const run: import("@/lib/repos").Runner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[0] === "label") return JSON.stringify([{ name: "bug", description: "" }, { name: "Enhancement", description: "" }]);
      if (args.includes("Broken one")) throw Object.assign(new Error("Command failed"), { stderr: "GraphQL: title too spicy" });
      return `https://github.com/acme/shop/issues/${calls.length}\n`;
    };
    const r = await repos.createIssues(
      shop(),
      [
        { title: "Fix login", body: "Steps…", labels: ["bug", "enhancement", "made-up"] },
        { title: "Broken one", body: "x" },
      ],
      run,
    );
    expect(r.created).toEqual([{ title: "Fix login", url: "https://github.com/acme/shop/issues/2" }]);
    expect(r.failed).toEqual([{ title: "Broken one", error: "GraphQL: title too spicy" }]);
    expect(r.droppedLabels).toEqual(["made-up"]);
    expect(calls[1]).toEqual(["gh", "issue", "create", "-R", "acme/shop", "--title", "Fix login", "--body", "Steps…", "--label", "bug", "--label", "Enhancement"]);
  });

  it("refuses issues on a repository without a GitHub remote", async () => {
    const tool = repos.resolveRepo(businessId, "tool") as ReturnType<typeof shop>;
    await expect(repos.listIssues(tool, {}, async () => "[]")).rejects.toThrow(/no GitHub remote/);
  });
});

describe("file access", () => {
  it("lets teammates read a connected repository but never write to it", () => {
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-ws-")));
    const repo = path.join(code, "shop");
    const file = path.join(repo, "src", "app.ts");
    fs.writeFileSync(file, "x");
    expect(checkFileAccess("Read", { file_path: file }, cwd, undefined, [repo]).behavior).toBe("allow");
    expect(checkFileAccess("Grep", { path: repo }, cwd, undefined, [repo]).behavior).toBe("allow");
    expect(checkFileAccess("Edit", { file_path: file }, cwd, undefined, [repo]).behavior).toBe("deny");
    expect(checkFileAccess("Read", { file_path: file }, cwd).behavior).toBe("deny");
    // Credentials stay closed even inside a readable repository.
    expect(checkFileAccess("Read", { file_path: path.join(repo, ".git", "config") }, cwd, undefined, [repo]).behavior).toBe("deny");
    expect(checkFileAccess("Read", { file_path: path.join(repo, ".env") }, cwd, undefined, [repo]).behavior).toBe("deny");
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("knows which repository files hold credentials", () => {
    for (const p of [".git/config", ".env", ".env.production", "config/server.key", "certs/a.pem", "deploy/id_ed25519", ".npmrc"]) expect(isSecretPath(p)).toBe(true);
    for (const p of ["src/env.ts", ".env.example", "README.md", "docs/.git-notes.md", "keyboard.tsx"]) expect(isSecretPath(p)).toBe(false);
  });
});

describe("approved backlog", () => {
  const tool = "mcp__github__create_issues";
  const approved = { toolName: tool, input: { repo: "shop", issues: [{ title: "Fix login", body: "Long body" }, { title: "Add tests", body: "More" }] } };

  it("matches the same repository and titles even when the bodies were reworded", () => {
    expect(sameBacklog(approved, tool, { repo: "Shop", issues: [{ title: "add tests", body: "x" }, { title: "Fix login ", body: "reworded" }] })).toBe(true);
  });

  it("doesn't match a different list, repository or tool", () => {
    expect(sameBacklog(approved, tool, { repo: "shop", issues: [{ title: "Fix login", body: "" }] })).toBe(false);
    expect(sameBacklog(approved, tool, { repo: "other", issues: approved.input.issues })).toBe(false);
    expect(sameBacklog(approved, "mcp__github__comment_issue", approved.input)).toBe(false);
  });
});
