/**
 * Ajudan desktop app. Every business runs in its own window with its own web server
 * and worker, pinned to that business folder (AJUDAN_DATA_DIR), so several
 * businesses work at the same time. A "Businesses" window (no worker) lists the
 * folders and opens them.
 *
 *   pnpm app            build the web app, then open Ajudan
 *   pnpm app:package    make Ajudan.app (a small shell that runs this repo)
 *
 * The app runs the code in this repo with your installed Node (better-sqlite3 is
 * built for it), so rebuild (`pnpm app`) after changing the code.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const pkg = require("./package.json");
const REPO = path.resolve(process.env.AJUDAN_REPO || pkg.ajudanRepo || path.join(__dirname, ".."));
const STATE_DIR = path.join(os.homedir(), ".ajudan");
const STATE_PATH = path.join(STATE_DIR, "app.json");
const HOME_KEY = "__home__";

app.setName("Ajudan");

// Apps opened from Finder get a bare PATH; use the login shell's (node, wacli, ffmpeg).
function loginPath() {
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__PATH__%s" "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
    });
    return out.split("__PATH__").pop();
  } catch {
    return "";
  }
}
process.env.PATH = [loginPath(), process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".volta/bin")]
  .filter(Boolean)
  .join(":");

/** key (folder path or HOME_KEY) → { win, web, worker, port, dir } */
const sessions = new Map();
let quitting = false;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { windows: [] };
  }
}

function saveOpenWindows() {
  if (quitting) return;
  const windows = [...sessions.keys()].filter((k) => k !== HOME_KEY);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ ...readState(), windows }, null, 2));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function logStream(dir, name) {
  const logs = dir ? path.join(dir, "logs") : path.join(STATE_DIR, "logs");
  fs.mkdirSync(logs, { recursive: true });
  return fs.createWriteStream(path.join(logs, `${name}.log`), { flags: "a" });
}

function run(name, args, { dir, port }) {
  // AJUDAN_PARENT_PID: the worker and web server quit by themselves if the app dies.
  const env = { ...process.env, AJUDAN_APP: "1", AJUDAN_PARENT_PID: String(process.pid), PORT: String(port ?? ""), NODE_ENV: "production" };
  if (dir) env.AJUDAN_DATA_DIR = dir;
  else delete env.AJUDAN_DATA_DIR;
  if (name === "worker") env.NODE_OPTIONS = "--disable-warning=CLAUDE_SDK_CAN_USE_TOOL_SHADOWED";
  // Its own process group: `node` may be a version-manager shim (Volta) and the worker
  // has children (tsx, wacli), so stopping means signalling the whole group.
  const child = spawn("node", args, { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const log = logStream(dir, name);
  log.write(`\n--- ${new Date().toISOString()} ${name} start ---\n`);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  return child;
}

function startWeb(dir, port) {
  return run("web", [path.join(REPO, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { dir, port });
}

function startWorker(dir) {
  return run("worker", [path.join(REPO, "node_modules/tsx/dist/cli.mjs"), "worker/index.ts"], { dir });
}

async function waitForServer(port, child, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error("The web server stopped while starting (see logs/web.log).");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("The web server didn't start in time.");
}

function loadingPage(title, detail) {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#1f1724;color:#f4e9d0;font:16px ui-monospace,Menlo,monospace">
<div style="text-align:center"><div style="font-size:28px;margin-bottom:12px">▣ Ajudan</div><div>${title}</div>
<div style="opacity:.6;margin-top:8px;font-size:13px;max-width:520px">${detail}</div></div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function businessName(dir) {
  return path.basename(dir);
}

function createWindow(key, title) {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title,
    backgroundColor: "#1f1724",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  // Links to other sites open in your normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith("http://127.0.0.1:")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("http://127.0.0.1:")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on("closed", () => {
    void stopSession(key);
  });
  return win;
}

async function openSession(key, dir) {
  const existing = sessions.get(key);
  if (existing) {
    if (existing.win.isMinimized()) existing.win.restore();
    existing.win.focus();
    return;
  }
  const title = dir ? `Ajudan · ${businessName(dir)}` : "Ajudan · Businesses";
  const win = createWindow(key, title);
  const session = { win, dir, web: null, worker: null, port: null };
  sessions.set(key, session);
  saveOpenWindows();
  win.loadURL(loadingPage(dir ? `Opening ${businessName(dir)}…` : "Opening…", dir ? dir : "Starting the web app"));
  try {
    await ensureBuild(win);
    session.port = await freePort();
    session.web = startWeb(dir, session.port);
    if (dir) session.worker = startWorker(dir);
    session.web.on("exit", (code) => {
      if (!quitting && sessions.get(key) === session && !win.isDestroyed()) {
        win.loadURL(loadingPage("The web server stopped", `Exit code ${code}. See ${dir ? path.join(dir, "logs/web.log") : "~/.ajudan/logs/web.log"}. Close this window and open it again.`));
      }
    });
    await waitForServer(session.port, session.web);
    if (!win.isDestroyed()) win.loadURL(`http://127.0.0.1:${session.port}/`);
  } catch (err) {
    if (!win.isDestroyed()) win.loadURL(loadingPage("Couldn't open", String(err.message || err)));
  }
}

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false; // the group is gone
  }
}

/** SIGTERM the child's whole process group, wait for it to be gone, SIGKILL what's left. */
async function stopChild(child, ms = 6000) {
  if (!child?.pid) return;
  if (!signalGroup(child, "SIGTERM")) return;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 200));
    if (!signalGroup(child, 0)) return;
  }
  signalGroup(child, "SIGKILL");
}

async function stopSession(key) {
  const s = sessions.get(key);
  if (!s) return;
  sessions.delete(key);
  saveOpenWindows();
  // The worker first: it stops WhatsApp sync and puts running work back in the queue.
  await stopChild(s.worker);
  await stopChild(s.web, 3000);
}

let building;
/** The app serves the production build; make it if it's missing. */
function ensureBuild(win) {
  if (fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) return Promise.resolve();
  building ??= new Promise((resolve, reject) => {
    win.loadURL(loadingPage("Building Ajudan…", "First start: building the web app. This takes a minute."));
    const child = run("build", [path.join(REPO, "node_modules/next/dist/bin/next"), "build"], {});
    child.on("exit", async (code) => {
      if (code === 0) return resolve();
      // Often another build is running (`pnpm app`, `pnpm build`): wait for its result.
      win.loadURL(loadingPage("Waiting for the build…", "Another build of Ajudan is running. This window opens when it's done."));
      const until = Date.now() + 5 * 60_000;
      while (Date.now() < until) {
        if (fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) return resolve();
        await new Promise((r) => setTimeout(r, 1000));
      }
      reject(new Error("The build failed (see ~/.ajudan/logs/build.log)."));
    });
  }).finally(() => (building = undefined));
  return building;
}

const openHome = () => openSession(HOME_KEY, null);
const openFolder = (dir) => openSession(path.resolve(dir), path.resolve(dir));

ipcMain.handle("ajudan:open-folder", (_e, dir) => {
  if (typeof dir !== "string" || !fs.existsSync(path.join(dir, "ajudan.db"))) throw new Error("Not a business folder");
  void openFolder(dir);
  return true;
});
ipcMain.handle("ajudan:show-home", () => {
  void openHome();
  return true;
});

function buildMenu() {
  const template = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { label: "Businesses…", accelerator: "CmdOrCtrl+N", click: () => void openHome() },
        {
          label: "Open Business Folder…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const r = await dialog.showOpenDialog({ properties: ["openDirectory"], defaultPath: path.join(os.homedir(), "Ajudan") });
            const dir = r.filePaths[0];
            if (!dir) return;
            if (!fs.existsSync(path.join(dir, "ajudan.db"))) {
              dialog.showErrorBox("Not a business folder", `${dir} has no ajudan.db.`);
              return;
            }
            void openFolder(dir);
          },
        },
        { type: "separator" },
        {
          label: "Show Logs",
          click: () => {
            const s = [...sessions.values()].find((x) => x.win.isFocused());
            shell.openPath(s?.dir ? path.join(s.dir, "logs") : path.join(STATE_DIR, "logs"));
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => void openHome());
  app.whenReady().then(() => {
    buildMenu();
    const last = (readState().windows || []).filter((d) => fs.existsSync(path.join(d, "ajudan.db")));
    if (last.length) last.forEach((d) => void openFolder(d));
    else void openHome();
  });
  app.on("activate", () => {
    if (!sessions.size) void openHome();
  });
  // macOS: closing every window keeps the app in the Dock (nothing runs).
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    // Remember which businesses were open, then stop everything.
    const windows = [...sessions.keys()].filter((k) => k !== HOME_KEY);
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ ...readState(), windows }, null, 2));
    quitting = true;
    Promise.allSettled([...sessions.keys()].map((k) => stopSession(k))).finally(() => app.exit(0));
  });
}
