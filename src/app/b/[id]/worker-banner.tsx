import { connection } from "next/server";
import { IN_APP, pinnedFolder } from "@/lib/app-mode";
import { readConfig } from "@/lib/folders";
import { folderWorker } from "@/lib/worker-lock";

/**
 * Shown when no worker holds the open folder's lock: nothing runs without one, and
 * the owner would otherwise watch "Researching your business…" forever.
 * Render inside <Suspense>: it reads the lock file at request time.
 */
export async function WorkerBanner() {
  await connection();
  const dir = IN_APP ? pinnedFolder() : readConfig().activeFolder;
  if (!dir || folderWorker(dir)) return null;
  return (
    <div role="status" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-foreground sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-pixel text-destructive">Worker not running</span>
        <span className="text-muted-foreground">
          {IN_APP
            ? "The team can't work until it restarts. Close this window and open the business again (see logs/worker.log in the business folder)."
            : "The team can't work until it starts: run `pnpm dev` (or `pnpm worker`) in the Ajudan repo."}
        </span>
      </div>
    </div>
  );
}
