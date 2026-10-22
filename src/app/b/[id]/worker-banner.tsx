import { connection } from "next/server";
import { currentDataDir } from "@/lib/paths";
import { folderWorker } from "@/lib/worker-lock";

/**
 * Is a worker holding the open folder's lock? Nothing runs without one, and the owner
 * would otherwise watch "Researching your business…" forever. The business shell shows
 * a "Worker not running" row in the sidebar footer (and a toast once) when this is false.
 * Request-time read: call it inside <Suspense>.
 */
export async function workerRunning() {
  await connection();
  const dir = currentDataDir(); // the pinned folder (app window, AJUDAN_DATA_DIR) or the open one
  return !dir || Boolean(folderWorker(dir));
}
