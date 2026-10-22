/**
 * A "folder session": the worker works on one business folder at a time. When you
 * switch folders, the session's signal aborts every running Claude call; handlers
 * then throw PausedError, and the worker puts the job back in that folder's queue
 * so it runs again the next time the folder is open.
 *
 * A task's run can also end early on purpose: when it needs the owner's approval
 * (ApprovalWait: the task waits, the decision resumes its session) or when the owner
 * cancels it (CancelledError: the web app sets the task cancelled, and the worker's
 * tick aborts the matching run, see `runningTasks`).
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

/** The run stopped to wait for the owner's decision on this approval. */
export class ApprovalWait extends Error {
  constructor(public readonly approvalId: string) {
    super("Waiting for the owner's approval");
  }
}

/** The owner cancelled the task while it ran. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled by the owner");
  }
}

/** Task runs in flight, so a cancellation from the web app can abort them. */
export const runningTasks = new Map<string, AbortController>();
