# Scalability plan

Audit and plan written by Fable (claude-fable-5-1), with key claims spot-checked against the code (2026-10-24). Nothing has been changed yet.

Target sizes: 10k work files, 5k media, 100k activity events, 20k tasks, 5k deliverables, 500 context pages, 10k contacts.

## 0. Two multipliers

1. **`LiveRefresh` turns per-visit cost into per-event cost.** `src/components/live.tsx:42-60` calls `router.refresh()` (300 ms debounce) on every matching event. The worker logs a `tool` event per step, so a slow page re-renders about once a second during a run. Pages with **no `types` filter** refresh on every event: `teammates/[tid]/teammate-view.tsx:450,459,655` and `health/page.tsx:104`.
2. **`/api/b/[id]/state` runs on every SSE event** (`office/use-office-live.ts:45,55,72`), and the office strip is on the chat home.

The worker is a separate process, so it can't invalidate a Next.js in-process cache. The only invalidation path is SSE → `router.refresh()`. Fix the queries; don't rely on `'use cache'`.

## 1. Hotspots, ranked

### S1: unbounded and hot

- **A. Teammate chat** (`teammate-view.tsx:46-68`): `activity_events WHERE type='tool' AND task_id IN (30 ids)` with no LIMIT. The only events index is `(business_id, id)` (`schema.ts:245`), so it scans the whole table. Up to 3k step strings are passed to client props, and the query re-runs on every event. `deliverableCount` (`:85-90`) is `.all().length`. The task list orders by `created_at` with no index for it.
- **B. Files page** (`src/lib/browse.ts:102-140`): stat for every entry, `readFileSync` of the head of every `.md`, and a `readdirSync` for every subfolder. `listDir` is called 2–3× per render (`files/page.tsx:224, 274, 416`; prev/next lists the whole folder). `searchFiles` (`browse.ts:144-158`) walks every root and reads every markdown head. There is no paging, and gallery tiles load the original images.
- **C. Context**: `listPages` is `select *` including `body` and `blocks` (`context.ts:33-35`), and runs 3–6× per render (layout, `contextBase`, `readerRows`, `pagesFor` per teammate on the home and readers pages). `listLibrary` (readdir + stat of all `media/`) runs twice per render (`page.tsx:87,92`). `usageThisWeek` scans `context_loads` by `(business_id, created_at)`, which has no index. `context_loads` is never pruned.
- **D. Business home `getProgress`** (`src/lib/data.ts:49-75`): loads every done task, every deliverable **including `versions`** (up to 10 full copies) just to count them, and every approval. It runs on `/b/[id]` and on every teammate page, once per event.
- **E. Office state** (`office/state.ts:53-69`): loads all deliverable ids and pending approvals to count them, on every SSE event. The same `.all().length` pattern appears in `data.ts:39-46`, `desk.ts:114-126` and `teammate-view.tsx:85-90`.
- **F. Studio**: the library sends all media to the client, renders every tile with no virtualization, and uses originals as thumbnails (`library.tsx:362, 437-442`). `studio/docs` sends 500 full deliverables (content + versions) to a client component.
- **G. Video/audio editors** (`src/lib/studio-data.ts:20-43`): one `ffprobe` subprocess per video, up to 120, on every render.
- **H. Worker `list_media`** (`worker/tools.ts:197-225`): readdir + stat of all media plus up to 40 `ffprobe` calls on every tool call.

### S2: linear growth that will show at the target sizes

- **I. Deliverables page**: full rows (content + versions) for a table that shows metadata only (`deliverables/page.tsx:77-83`). Status counts load rows instead of using `GROUP BY` (`:86`). `deliverables` has no index besides the primary key.
- **J. `claimJob` → `spentToday`** (`src/lib/jobs.ts:84`, `budget.ts:45-52`): sums task costs with no index, every 500 ms × 4 lanes, even when the budget cap is 0.
- **K. `activity_events` volume**: pruning is by time only (30 days). A busy team reaches about 100k rows as its normal level.
- **L. Context title lookups and search** (`findPage`, `search_context`, `subtreeIds`, `movePage`) load every page body.
- **M. Contacts** are always loaded whole (`contacts.ts:43-45`), and the whole list is sent to the client on `context/people`.
- **N. Desk**: one `wacli` subprocess per chat on every `/desk` render (`desk.ts:68-76`).
- **O. Missing indexes**:
  - `tasks (business_id, status)`, `(teammate_id, created_at)`, `(business_id, finished_at)`, `(parent_task_id)`, `(deliverable_id)`
  - `deliverables (business_id, created_at)`, `(business_id, status)`, `(teammate_id)`, `(task_id)`
  - `activity_events (task_id, type, id)`, `(business_id, type, created_at)`
  - `context_loads (business_id, created_at)`, `(business_id, teammate_id, id)`
  - `human_messages (human_id, sent_at)`
  - `wa_watches (business_id, status)`
  - `assets (business_id)`
  - `context_suggestions (task_id)`, `(page_id, status)`
  - `contacts (business_id, name)`
- **P. No thumbnails anywhere.** Tiles in the files page, library and image strip all load the originals.

### Fine already

- The SSE route uses a cursor, resumes with `?since`, reads 200 rows per tick and uses the index. It does not replay history.
- These are already bounded: `taskHistory`, approvals (limit 200), health, title search (limit 8), memory reads, and `claimJob`'s queued scan.

## 2. Budgets (at the target sizes)

- Server render p95 < 200 ms on every page; `/api/state` < 10 ms; SSE tick < 5 ms.
- RSC payload < 300 KB per page; DOM nodes bounded by the viewport (virtualized or paged lists).
- Library and Files first paint < 1 s, with thumbnails ≤ 30 KB each.
- Worker `list_media` / `search_context` / `search_contacts` < 300 ms.
- Reconciling a 15k-file folder in the worker < 5 s.

## 3. Strategy

1. **Query SQLite, never walk the disk during a render.** `work/*.md` already mirrors the `deliverables` table, so list from the DB. Add a **`folder_files`** table (path, root, parent, name, kind, bytes, mtime, title, width/height/duration, probed_at, thumb). Writers upsert into it directly. A cheap subtree reconcile (readdir + stat, diff on (bytes, mtime)) runs after each teammate run, after media writes, when a folder is opened and daily in maintenance. This is required because teammates write files through Claude Code's own tools, which the app never sees. Lists may lag by a few seconds; opening a file always stats the real file. Backfills run in the worker, never inside `runMigrations`.
2. **Do counts and aggregates in SQL**: `count(*)`, `GROUP BY`, `json_array_length(versions)`.
3. **Select only the columns the view needs**: `listPageHeads` without body; deliverable and task lists without content, versions, instructions or result; load one doc by id for a peek.
4. **Keyset pagination** on `(created_at, id)` / `(mtime, path)`, with "load more" Server Functions in each route's `actions.ts`. Virtualize the library and files grids (`@tanstack/react-virtual` or a simple windowed grid).
5. **Caching**: React `cache()` to dedupe within one render (safe, removes the 3–6× context loads). Use `'use cache'` only with a short `cacheLife` and explicit `dir` + `businessId` arguments, and only if a measurement shows it is still needed.
6. **Thumbnails** with ffmpeg into `<folder>/.cache/thumbs/`, served by a new `/api/b/[id]/thumb/[...path]` route that generates on demand.
7. **Events**: keep the newest 200 `tool` events per task when the task ends; keep at most 50k rows per business; prune `context_loads` after 90 days. Teammate chat: limit steps per task with a window function, and exclude `tool`/`text` from `LiveRefresh` (live steps already come through `useActivity`).
8. **FTS5** (available in the bundled better-sqlite3) through a custom drizzle migration with triggers, for deliverables, context pages, contacts and folder_files.
9. **Move subprocesses out of renders**: store probe results in `folder_files`, filled by a token-free worker job; cache desk summaries in the worker.

## 4. Phases

### Phase 0: measure
- `scripts/seed-scale.ts`: builds a synthetic folder with `AJUDAN_DATA_DIR` and flags `--files --media --events --tasks --pages --contacts`.
- `scripts/bench-pages.ts`: runs `next build` + `next start`, then reports p50/p95 render time and RSC bytes for each route, plus `EXPLAIN QUERY PLAN` for the hot queries.
- `src/lib/timing.ts` `timed()`, logged when `AJUDAN_TIMING=1`. Record the baseline in `docs/PERF.md`.

### Phase 1: quick wins (one additive index migration)
1. The indexes in §O (`pnpm db:generate` → `pnpm db:migrate`).
2. Replace `.all().length` with `count(*)` / `GROUP BY` (office state, pending approvals, desk score, teammate deliverables, deliverables page, suggestions).
3. `getProgress`: drop `versions`, use `json_array_length`, compute totals in SQL, and limit level-ups to recent outcomes. Keep `tests/progress.test.ts` passing.
4. Teammate chat: limit steps per task, select explicit columns, filter `LiveRefresh` types.
5. Context: `listPageHeads` + `cache()`; load cover and gallery pickers lazily.
6. Deliverables and docs studio: heads only, peek by id.
7. Files page: one `listDir` per render, page folders at 300 entries.
8. Editors: probe only when a source is added, or cap at the newest 40.
9. Events: caps and prunes; skip `spentToday` when the budget cap is 0.

### Phase 2: structural
1. `folder_files` + `src/lib/file-index.ts` (reconcile, upsert, remove, listFolder, search) + writer hooks; the Files page reads the index.
2. A `probe_media` worker job + thumbnails; library, editors and `list_media` read the index.
3. Virtualized or paged grids and tables; contacts paged with server-side search.
4. FTS5 search everywhere.
5. Context prompts load bodies only for always-pages.

### Phase 3: nice-to-haves
- Move `deliverables.versions` into a `deliverable_versions` table.
- One shared `EventSource` per tab.
- A `desk_chats` summary cache.
- Short `'use cache'` on health tiles and progress.
- An events archive.

## 5. Risks

- **Disk vs index**: lists may lag; opening a file never lies. A 404 drops the row.
- **Migrations**: additive only; backfills run in the worker. Any migration that rebuilds an FTS-backed table must recreate the triggers (add a note to AGENTS.md).
- **Electron**: one worker per folder means one index writer, plus the upload route (WAL + busy_timeout are already set).
- **Dev mode**: one web process follows `config.json`, so any in-process cache must be keyed by `dir`.
