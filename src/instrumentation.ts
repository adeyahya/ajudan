/** Started by the desktop app: the web server quits if the app is gone (crashed or force-quit). */
export function register() {
  const parent = Number(process.env.AJUDAN_PARENT_PID);
  if (!parent || process.env.NEXT_RUNTIME !== "nodejs") return;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 5000).unref();
}
