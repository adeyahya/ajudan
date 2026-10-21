# Ajudan

AI teammates for your business. Ajudan interviews you about the business, designs a team of AI teammates, runs them on real work, and shows them in a 2D pixel-art office.

![Office](docs/office-screenshot.png)

## Run it locally

Requirements: Node 22+, pnpm, and Claude Code installed and logged in (`claude`). Every LLM call goes through headless Claude Code (the Agent SDK) using your login.

```bash
pnpm install
pnpm dev        # creates the SQLite schema, starts Next.js on :3000 and the worker
```

Open http://localhost:3000, add your business and website, and do the interview.

## How it works

- **Web app** (Next.js 16, shadcn/ui): onboarding chat, team review, office, teammate chats, approvals, work.
- **Worker** (`worker/`): takes jobs from SQLite and runs each one with `runAgent()` (`src/lib/claude.ts`).
  - Each teammate runs in its own folder, `data/workspaces/<business>/<teammate>/`, with `BUSINESS.md` and its own `memory.md`.
- **Teammate tools** (`worker/tools.ts`): save work, delegate to a teammate, update their status, and publish/send.
  - Publish/send are **simulated**: no real integrations yet.
  - Autonomy setting: `draft` never publishes, `ask` needs your approval, `auto` acts alone.
- **Data**: SQLite at `data/ajudan.db` (Drizzle; schema in `src/db/schema.ts`). Live updates reach the browser over SSE from `activity_events`.

## Useful commands

```bash
pnpm typecheck && pnpm lint
pnpm worker:once                           # process queued jobs, then exit
AJUDAN_DATA_DIR=.test-data/demo pnpm dev   # use a separate data folder
```

Before letting other businesses use it, set `ANTHROPIC_API_KEY`. Anthropic's terms don't allow serving other users on a Pro/Max subscription login.

## Known limitations

- `pnpm dev` runs the worker with `tsx watch`: editing files restarts it and any running task starts over from scratch.
- Teammate schedules (e.g. Mondays 08:00) run automatically while the worker is up, and they use your Claude quota.
- No real integrations yet: publishing and sending only record the action.
