# Ajudan

AI teammates for your business. Ajudan interviews you about the business, designs a team of AI teammates, runs them on real work, and shows them in a 2D pixel-art office.

![Office](docs/game-ui.jpg)

## Run it locally

Requirements: Node 22+, pnpm, and Claude Code installed and logged in (`claude`). Every LLM call goes through headless Claude Code (the Agent SDK) using your login.

```bash
pnpm install
pnpm dev        # creates the SQLite schema, starts Next.js on :3000 and the worker
```

Open http://localhost:3000, add your business and website, and do the interview.

**One folder per business.** Each business lives in its own folder, by default `~/Ajudan/<Name>/`:

```
~/Ajudan/Orucraft/
  ajudan.db          team, tasks, approvals, history
  teammates/raka/    memory.md, BUSINESS.md, drafts
  work/              every deliverable as a .md file
  browser/           the business's logged-in Chrome profile
  backups/           database backups taken before schema changes
```

- **Switching:** the home page (or **Switch** in the header) lists your business folders. Only the open business works: its teammates run tasks and schedules, while the others are paused. When you switch, any running task goes back to its queue and runs again when you return.
- **Copying, moving, backing up:** do it to the folder. **Open a business folder** adds one that isn't listed.

## How it works

- **Web app** (Next.js 16, shadcn/ui with a pixel-game theme in `globals.css`): onboarding chat, team review, office, teammate chats, approvals, work.
- **Worker** (`worker/`): takes jobs from SQLite and runs each one with `runAgent()` (`src/lib/claude.ts`).
  - Each teammate runs in its own folder, `data/workspaces/<business>/<teammate>/`, with `BUSINESS.md` and its own `memory.md`.
- **Teammate tools** (`worker/tools.ts`): save work, delegate to a teammate, update their status, and publish/send.
  - Publish/send are **simulated**: no real integrations yet.
  - Autonomy setting: `draft` never publishes, `ask` needs your approval, `auto` acts alone.
- **Language**: each business has a primary language (e.g. Bahasa Indonesia), set at creation or on the Business page; every agent writes in it.
- **Business browser**: each business has its own Chrome profile in `data/browsers/<id>`. Open it from **Business → Business browser**, log in to Shopee Seller Center, TikTok, etc. once, then turn on "Can use the business browser" for a teammate on the Team page. Teammates drive it through Playwright MCP over CDP (`worker/browser.ts`, swappable provider):
  - They only open sites on the business's list.
  - They never type passwords or codes.
  - Before changing anything on a site they call `confirm_browser_action`, which follows their freedom setting (draft-only never changes anything).
  - One teammate drives the browser at a time.
- **WhatsApp** (via [wacli](https://wacli.sh), `brew install openclaw/tap/wacli`): link the business's WhatsApp on **Business → WhatsApp** by scanning a QR code. The session and message store live in `<folder>/whatsapp/`.
  - Tick the groups or communities teammates may use (e.g. the reseller community); every other chat stays invisible to them.
  - Turn on "Can use WhatsApp" for a teammate on the Team page. They can read and search those chats for context and post updates; posting follows their freedom setting (approvals for "ask first", never for "draft only").
  - Teammates can also create a group (`create_group`), rename it, set its description or make it admins-only (`update_group`), and fetch its invite link. Changes go through approvals like posts. A group's picture can't be set via wacli, so set it on the phone.
  - While the folder is open, the worker keeps `wacli sync --follow` running and spaces sends 2–6s apart.
  - wacli uses the unofficial WhatsApp Web protocol, so keep volume human-sized.
- **Images**: teammates design social posts and carousel slides as HTML and render them to PNG (`render_image`, headless Chrome via `playwright-core`). Images are saved to `<folder>/work/images/` and attached to the work. See them on the Work page and under the teammate's reply; click a thumbnail to view it large or download it.
- **Data**: SQLite at `<business folder>/ajudan.db` (Drizzle; schema in `src/db/schema.ts`). Live updates reach the browser over SSE from `activity_events`.

## Useful commands

```bash
pnpm typecheck && pnpm lint
pnpm worker:once                           # process queued jobs, then exit
pnpm db:generate && pnpm db:migrate        # after editing src/db/schema.ts (never drizzle-kit push)
AJUDAN_DATA_DIR=/tmp/demo pnpm dev         # pin one business folder (tests)
```

Before letting other businesses use it, set `ANTHROPIC_API_KEY`. Anthropic's terms don't allow serving other users on a Pro/Max subscription login.

## Known limitations

- Moving from the old shared `./data` folder: `npx tsx scripts/move-to-folder.ts <businessId>` copies a business into `~/Ajudan/<Name>/`. Orucraft has been moved already, and `./data` can be deleted once you are happy.
- `pnpm dev` runs the worker with `tsx watch`: editing files restarts it and any running task starts over from scratch.
- Teammate schedules (e.g. Mondays 08:00) run automatically while the worker is up, and they use your Claude quota.
- `publish_deliverable` / `send_message` only record the action; real outward channels are the business browser and WhatsApp.
- The "ask before changing a site" rule is enforced by the teammate's instructions plus approvals, not by blocking clicks. The site list and the blocked tools are hard limits.
