/**
 * Ajudan desktop app. Every open business runs its own web server and worker, pinned
 * to that business folder (AJUDAN_DATA_DIR), so several businesses work at the same
 * time, headless. One window shows one of them at a time; switching (like Notion's
 * workspaces) points the window at another business's server and leaves the rest
 * running. The Businesses list (a web server with no folder and no worker) opens,
 * switches and stops them. Closing the window keeps them working; quitting stops all.
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

/** key (folder path or HOME_KEY) → { web, worker, port, dir, ready } */
const sessions = new Map();
/** The one window, and the session it shows. */
let mainWindow = null;
let active = null;
let quitting = false;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { windows: [] };
  }
}

/** The running businesses (still called `windows`, so older builds read it) and the one on screen. */
function writeState() {
  const windows = [...sessions.keys()].filter((k) => k !== HOME_KEY);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ ...readState(), windows, active: active !== HOME_KEY ? active : null }, null, 2));
}

function saveState() {
  if (!quitting) writeState();
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

/** A log past this size is moved aside as <name>.log.1 (the previous one is dropped). */
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function logStream(dir, name) {
  const logs = dir ? path.join(dir, "logs") : path.join(STATE_DIR, "logs");
  fs.mkdirSync(logs, { recursive: true });
  const file = path.join(logs, `${name}.log`);
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // no log yet
  }
  return fs.createWriteStream(file, { flags: "a" });
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

const titleFor = (key) => (key && key !== HOME_KEY ? `Ajudan · ${businessName(key)}` : "Ajudan · Businesses");

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Ajudan",
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
  // Closing the window hides the businesses, it doesn't stop them (the Dock icon brings it back).
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

/** The window, made if it was closed, in front. */
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

/** Load what `key`'s session has on screen, if it's still the one to show. */
function present(key, url) {
  if (active !== key || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitle(titleFor(key));
  mainWindow.loadURL(url);
}

/** Start a business (or the Businesses list) in the background; returns its session. */
function startSession(key, dir) {
  const existing = sessions.get(key);
  if (existing) {
    // Something stopped (a crashed server, a failed start): the next switch starts it again.
    if (existing.dir && !existing.worker && !existing.starting) {
      existing.worker = startWorker(existing.dir);
      watchWorker(key, existing);
    }
    if (!existing.web && !existing.starting) {
      existing.ready = startWebFor(key, existing);
      existing.ready.catch(() => {});
    }
    return existing;
  }
  const session = { dir, web: null, worker: null, port: null, ready: null, starting: true };
  sessions.set(key, session);
  saveState();
  session.ready = (async () => {
    try {
      await ensureBuild(key);
    } finally {
      session.starting = false;
    }
    if (sessions.get(key) !== session) return;
    if (dir) {
      session.worker = startWorker(dir);
      watchWorker(key, session);
    }
    await startWebFor(key, session);
  })();
  // A failure shows when the session is on screen (switchTo); the next switch tries again.
  session.ready.catch(() => {});
  return session;
}

async function startWebFor(key, session) {
  session.starting = true;
  try {
    session.port = await freePort();
  } finally {
    session.starting = false;
  }
  const web = startWeb(session.dir, session.port);
  session.web = web;
  web.on("exit", (code) => {
    if (session.web === web) session.web = null;
    if (quitting || sessions.get(key) !== session) return;
    present(key, loadingPage("The web server stopped", `Exit code ${code}. See ${session.dir ? path.join(session.dir, "logs/web.log") : "~/.ajudan/logs/web.log"}. Open it again from the Businesses list to restart it.`));
  });
  await waitForServer(session.port, web);
}

/** Show `key` in the window (starting it first if needed); the others keep running. */
async function switchTo(key, dir) {
  const win = showWindow();
  active = key;
  saveState();
  const session = startSession(key, dir);
  win.setTitle(titleFor(key));
  if (session.web && session.port && win.webContents.getURL().startsWith(`http://127.0.0.1:${session.port}/`)) return;
  win.loadURL(loadingPage(dir ? `Opening ${businessName(dir)}…` : "Opening…", dir ? dir : "Starting the web app"));
  try {
    await session.ready;
    present(key, `http://127.0.0.1:${session.port}/`);
  } catch (err) {
    present(key, loadingPage("Couldn't open", String(err.message || err)));
  }
}

/** Restarts within this window count towards the cap; after it, the slate is clean. */
const WORKER_RESTART_WINDOW_MS = 10 * 60_000;
const WORKER_MAX_RESTARTS = 3;

/**
 * The worker is what makes the team work: if it dies (crash, out of memory), start
 * it again with a growing delay. After a few crashes in a row, stop trying: the web
 * app shows a "Worker not running" banner and logs/worker.log has the reason.
 */
function watchWorker(key, session) {
  const child = session.worker;
  child.on("exit", (code, signal) => {
    if (quitting || sessions.get(key) !== session) return;
    const now = Date.now();
    session.workerExits = (session.workerExits ?? []).filter((t) => now - t < WORKER_RESTART_WINDOW_MS);
    session.workerExits.push(now);
    const n = session.workerExits.length;
    const log = logStream(session.dir, "worker");
    if (n > WORKER_MAX_RESTARTS) {
      // Opening the business again (switching to it) tries once more.
      session.worker = null;
      session.workerExits = [];
      log.end(`--- ${new Date().toISOString()} worker stopped (${signal ?? code}) ${n - 1} times in ${WORKER_RESTART_WINDOW_MS / 60_000} min; not restarting ---\n`);
      return;
    }
    const delay = 2000 * 2 ** (n - 1);
    log.end(`--- ${new Date().toISOString()} worker stopped (${signal ?? code}); restarting in ${delay / 1000}s (${n}/${WORKER_MAX_RESTARTS}) ---\n`);
    setTimeout(() => {
      if (quitting || sessions.get(key) !== session) return;
      session.worker = startWorker(session.dir);
      watchWorker(key, session);
    }, delay);
  });
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
  saveState();
  // The worker first: it stops WhatsApp sync and puts running work back in the queue.
  await stopChild(s.worker);
  await stopChild(s.web, 3000);
}

let building;
/** The app serves the production build; make it if it's missing. */
function ensureBuild(key) {
  if (fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) return Promise.resolve();
  const say = (title, detail) => present(active ?? key, loadingPage(title, detail));
  building ??= new Promise((resolve, reject) => {
    say("Building Ajudan…", "First start: building the web app. This takes a minute.");
    const child = run("build", [path.join(REPO, "node_modules/next/dist/bin/next"), "build"], {});
    child.on("exit", async (code) => {
      if (code === 0) return resolve();
      // Often another build is running (`pnpm app`, `pnpm build`): wait for its result.
      say("Waiting for the build…", "Another build of Ajudan is running. This window opens when it's done.");
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

const openHome = () => switchTo(HOME_KEY, null);
const openFolder = (dir) => switchTo(path.resolve(dir), path.resolve(dir));

/** Stop a business's worker and server; if it was on screen, show the Businesses list. */
async function stopFolder(dir) {
  const key = path.resolve(dir);
  if (!sessions.has(key)) return false;
  if (active === key) present(key, loadingPage(`Stopping ${businessName(key)}…`, "Its team finishes what it can and puts the rest back in the queue."));
  await stopSession(key);
  if (active === key) await openHome();
  return true;
}

ipcMain.handle("ajudan:open-folder", (_e, dir) => {
  if (typeof dir !== "string" || !fs.existsSync(path.join(dir, "ajudan.db"))) throw new Error("Not a business folder");
  void openFolder(dir);
  return true;
});
// A folder chosen in the system dialog (connecting a code repository), or null when cancelled.
ipcMain.handle("ajudan:pick-folder", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? mainWindow;
  const opts = { properties: ["openDirectory"], defaultPath: path.join(os.homedir(), "dev") };
  const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
  return r.canceled ? null : (r.filePaths[0] ?? null);
});
ipcMain.handle("ajudan:stop-folder", (_e, dir) => {
  if (typeof dir !== "string") throw new Error("Not a business folder");
  return stopFolder(dir);
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
          label: "Stop This Business",
          click: () => {
            if (active && active !== HOME_KEY) void stopFolder(active);
          },
        },
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
            const s = active ? sessions.get(active) : null;
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
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) showWindow();
    else void (active ? switchTo(active, active === HOME_KEY ? null : active) : openHome());
  });
  app.whenReady().then(() => {
    buildMenu();
    // Start every business that was running; show the one that was on screen.
    const state = readState();
    const last = (state.windows || []).filter((d) => fs.existsSync(path.join(d, "ajudan.db"))).map((d) => path.resolve(d));
    const show = last.find((d) => d === state.active) ?? last[0];
    for (const d of last) if (d !== show) startSession(d, d);
    if (show) void openFolder(show);
    else void openHome();
  });
  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) return showWindow();
    if (active && sessions.has(active)) void switchTo(active, active === HOME_KEY ? null : active);
    else void openHome();
  });
  // macOS: closing the window keeps the app (and every running business) going in the Dock.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    // Remember which businesses were running and which was on screen, then stop everything.
    writeState();
    quitting = true;
    Promise.allSettled([...sessions.keys()].map((k) => stopSession(k))).finally(() => app.exit(0));
  });
}
