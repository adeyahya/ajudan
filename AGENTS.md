<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Ajudan project conventions

Ajudan onboards a business through an AI interview, designs a team of AI teammates, and runs them. The office view shows them working.

- **Processes:** `pnpm dev` runs the Next.js app and the worker (`worker/index.ts`). **All Claude calls happen in the worker**, never in Next.js. The web app only reads and writes SQLite and enqueues jobs (`enqueueJob` in `src/lib/jobs.ts`).
- **LLM:** call Claude only through `runAgent()` in `src/lib/claude.ts`. It wraps the Claude Agent SDK, which is headless Claude Code using the local login. Default model `MODELS.main` (claude-opus-5-5).
- **Business folders:** one business = one folder (default `~/Ajudan/<Name>/`) holding `ajudan.db`, `teammates/<name>/`, `work/*.md`, `browser/` and `backups/`. Only the open folder (`~/.ajudan/config.json`, see `src/lib/folders.ts`) is active, and the worker pauses and requeues jobs when you switch. Use the helpers in `src/lib/paths.ts` (`dataDir()`, `resolveWorkspace()`, `workDir()`); never hard-code `./data`. `db` from `@/db` always means the open folder's database. Set `AJUDAN_DATA_DIR` to pin one folder (tests, scripts).
- **DB:** SQLite with Drizzle. The schema is in `src/db/schema.ts`. To change it: edit the schema, run `pnpm db:generate` (writes a migration in `drizzle/`), then `pnpm db:migrate`. **Never use `drizzle-kit push`**: on SQLite it rebuilds tables and cascade-deletes rows. `db:migrate` backs up to `data/backups/` first and refuses to finish if rows were lost. 
- **Usage limit:** `runAgent()` throws `UsageLimitError` when Claude's usage is used up. Handlers rethrow it (don't mark work failed); the worker requeues the job and the team "rests" (`src/lib/rest.ts`, shared `~/.ajudan/rest.json`) until the reset, running only token-free jobs (human teammates). The owner can answer customers on the Customer Desk (`/b/[id]/desk`, `src/lib/desk.ts`) meanwhile.
- **Live updates:** the worker writes `activity_events` with `logEvent()` (`src/lib/events.ts`). The browser gets them from `/api/b/[id]/events` over SSE. Use `<LiveRefresh businessId>` or `useActivity()` from `src/components/live.tsx`.
- **Pages (Next 16 + Cache Components):** `page.tsx` is a non-async component that renders `<Suspense fallback={<PageSkeleton/>}><Content params={props.params}/></Suspense>`. `Content` is async, awaits params, and reads data through helpers that `await connection()` first (see `src/lib/data.ts`). Mutations are Server Functions (`'use server'`) in a colocated `actions.ts`, followed by `revalidatePath`/`refresh()`. Params and route types: `PageProps<'/b/[id]'>`, `LayoutProps`, `RouteContext`.
- **UI:** use the primitives in `src/components/ui.tsx` and the theme tokens (`bg-surface`, `border-line`, `text-muted`, `bg-accent`). Tailwind v4.
- **Media:** owner uploads live in `<folder>/media/`; tasks carry them in `tasks.attachments` (folder-relative `media/…` / `work/…` paths, see `src/lib/media.ts`). The files route serves only `work/` and `media/`. Teammate skills live in `agent-plugins/ajudan-video/` (loaded with `plugins`/`skills` in `runAgent`; `settingSources: []` means `~/.claude` is never read). Keep Remotion packages pinned to one identical version.
- **Desktop app:** `electron/main.cjs` runs one `next start` + worker per business window with `AJUDAN_DATA_DIR` pinned and `AJUDAN_APP=1` (`src/lib/app-mode.ts`); the Businesses window has no worker. Folder actions return `openDir` in the app and the page calls `window.ajudan.openFolder` (`src/lib/app-bridge.ts`). Workers take `<folder>/.worker.lock` (`src/lib/worker-lock.ts`), so never run two on one folder.
- **Credentials & abilities:** never put secrets in prompts, files or the DB; use `src/lib/secrets.ts` (Keychain) and `{{secret.NAME}}` in `http_request`. New teammate abilities should be requestable (`request_capability`, `src/lib/capabilities.ts`) rather than only a switch the owner has to find.
- **Checks:** `pnpm typecheck`, `pnpm lint`.
