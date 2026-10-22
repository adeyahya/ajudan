/**
 * Make Ajudan.app: a small Electron shell (electron/) that runs this repo. The app
 * isn't a copy of the code: it starts the web server and workers from this folder,
 * so after changing code run `pnpm build` (or `pnpm app`) and reopen the app.
 *
 *   pnpm app:package             → dist/Ajudan-darwin-<arch>/Ajudan.app
 *   pnpm app:package --install   → also copies it to ~/Applications
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronVersion = JSON.parse(fs.readFileSync(path.join(repo, "node_modules/electron/package.json"), "utf8")).version;

// The shell: electron/ plus the repo path it should run.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-app-"));
for (const f of ["main.cjs", "preload.cjs"]) fs.copyFileSync(path.join(repo, "electron", f), path.join(stage, f));
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "electron/package.json"), "utf8"));
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ ...pkg, ajudanRepo: repo }, null, 2));

console.log("Building the web app…");
execFileSync(process.execPath, [path.join(repo, "node_modules/next/dist/bin/next"), "build"], { cwd: repo, stdio: "inherit" });

const [out] = await packager({
  dir: stage,
  out: path.join(repo, "dist"),
  name: "Ajudan",
  appBundleId: "app.ajudan.desktop",
  appCategoryType: "public.app-category.business",
  electronVersion,
  overwrite: true,
  // macOS asks before the Studio's audio editor records a voice-over.
  extendInfo: { NSMicrophoneUsageDescription: "Ajudan records voice-overs and voice notes in the Studio." },
  asar: false,
  prune: false,
});
fs.rmSync(stage, { recursive: true, force: true });
const appPath = path.join(out, "Ajudan.app");
console.log(`\nMade ${appPath}`);

if (process.argv.includes("--install")) {
  const dest = path.join(os.homedir(), "Applications", "Ajudan.app");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(appPath, dest, { recursive: true, verbatimSymlinks: true });
  console.log(`Installed ${dest}`);
}
