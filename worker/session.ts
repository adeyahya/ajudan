/**
 * A "folder session": the worker works on one business folder at a time. When you
 * switch folders, the session's signal aborts every running Claude call; handlers
 * then throw PausedError, and the worker puts the job back in that folder's queue
 * so it runs again the next time the folder is open.
 */

let controller = new AbortController();

export function folderSignal() {
  return controller.signal;
}

/** Abort everything running for the current folder and start a fresh session. */
export function endFolderSession() {
  controller.abort(new PausedError());
  controller = new AbortController();
}

/** An AbortController for one runAgent call, tied to the folder session. */
export function runAbortController() {
  const signal = folderSignal();
  const c = new AbortController();
  if (signal.aborted) c.abort(signal.reason);
  else signal.addEventListener("abort", () => c.abort(signal.reason), { once: true });
  return c;
}

export class PausedError extends Error {
  constructor() {
    super("Paused: the business folder was closed. This job will run again when it's reopened.");
  }
}

export const isPaused = (signal: AbortSignal) => signal.aborted && signal.reason instanceof PausedError;
