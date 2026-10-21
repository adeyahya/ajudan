/**
 * Migrate the open business folder (or $AJUDAN_DATA_DIR). The app also does this
 * automatically whenever it opens a folder; see src/lib/migrate.ts.
 */
import { runMigrations } from "@/lib/migrate";
import { currentDataDir } from "@/lib/paths";

const dir = currentDataDir();
if (!dir) {
  console.log("[db] no business folder is open; nothing to migrate");
} else {
  try {
    runMigrations(dir, console.log);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
