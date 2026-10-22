# Ajudan roadmap: from working spine to trustworthy product

Written 2026-10-22 from three read-only audits (product, architecture/reliability, teammate quality) run on Fable against `966e925`. `pnpm typecheck` and `pnpm lint` pass. There are **no tests**.

The spine works: interview → profile → team design → hire → manager chat → approvals (web or WhatsApp `ya CODE`) → Work/Files. The gaps are **honesty** (what actually went out), **durability** (restarts and long approvals), **learning** (owner corrections are lost), and **the Indonesian owner** (English UI, WhatsApp setup is hard to find).

Sizes: S ≈ under half a day, M ≈ 1–2 days, L ≈ a week or more.

---

## Milestone 1: Safe and honest (do first)

| # | Item | Why | Where | Size |
|---|------|-----|-------|------|
| 1.1 | **Stop pretending to publish.** Replace `publish_deliverable`/biz `send_message` with `mark_ready_to_post` (status `ready_to_post`, no approval gate). The Work page shows "Ready to post · Copy". Reword the prompt line that says the team may "publish and send directly". Rename the biz tool so it no longer collides with `mcp__whatsapp__send_message`. | Today the owner approves "Publish to instagram", the badge flips to `published`, and nothing is posted. This is the biggest risk to trust. | `worker/tools.ts:85,408-451`, `worker/handlers/task.ts:509,532`, `approvals/page.tsx:218-235` | M |
| 1.2 | **Close the render read-escape.** Add a webpack resolver restriction (and a rule for `.json` and asset loads) that rejects any resolved path outside the task cwd and `node_modules`. | Teammate TSX bundled in the unsandboxed worker can `import` `~/.claude/.credentials.json` or `.secrets.json`, render it into a frame, then read it and send it out with WebFetch. | `worker/video.ts:67-80` | M |
| 1.3 | **Bind dev to localhost.** `next dev -H 127.0.0.1`. | `pnpm dev` serves an app with no auth on `0.0.0.0`, so anyone on the LAN can approve actions, save secrets or send WhatsApp messages. | `package.json` `dev` script | S |
| 1.4 | **Block SSRF and symlink escapes.** Remove the `http://localhost` exception from `http_request`. Use `realpath` plus an inside-cwd check in `send_file` and `render_video`. Default-deny the browser when `browserSites` is empty. | Requests to localhost reach the open app API and Chrome's CDP. A symlink can send `~/.ssh` over WhatsApp. | `worker/tools.ts:309,483`, `worker/whatsapp-tools.ts:213`, `worker/browser.ts:108` | S |
| 1.5 | **Show attachments in approvals.** Render `ImageStrip` for `d.attachments` and send 1–3 files with the WhatsApp approval notice. | Today the owner approves images and videos without seeing them. | `approvals/page.tsx`, `worker/owner-approvals.ts:28-37` | S |
| 1.6 | **"Worker not running" banner.** Check `folderWorker(dir)` in the business layout. Electron watches the worker's exit. Wrap `switchTo` in try/finally. | Without a worker the owner sees "Researching your business…" forever. A failed `activate()` leaves `switching=true`, which wedges the worker silently. | `src/app/b/[id]/layout.tsx`, `worker/index.ts:97-108`, `electron/main.cjs:178` | S |

## Milestone 2: Durable work

| # | Item | Why | Where | Size |
|---|------|-----|-------|------|
| 2.1 | **Approvals stop holding a run open.** On `ask`, persist `sessionId`, end the run as `waiting_approval`, and free the slot. The decision creates a continuation task that `resume`s ("proceed" or "revise: <note>"). Mark stale approvals `superseded` instead of deleting them on `activate()`. | Two pending approvals freeze the team (concurrency is 2). A restart deletes approvals, so the owner's next-morning WhatsApp `ya A7F2` gets "Kode tidak ditemukan", and the task starts over and saves duplicate deliverables. | `worker/handlers/task.ts:187-204,287-292`, `worker/index.ts:84` | M |
| 2.2 | **Graceful shutdown and retry cap.** On SIGTERM, call `endFolderSession()` and await `inflight` with a timeout. Read `attempts`: after N tries the job becomes `failed` and logs `task_failed`. Add an `unhandledRejection` handler. | Every `tsx watch` restart or window close re-runs side effects (WhatsApp sends, deliverables). A job that crashes the worker loops forever. | `worker/index.ts:143-148`, `src/lib/jobs.ts:45,69-71` | M |
| 2.3 | **Cancel and retry.** Add Cancel on queued and running tasks (set `cancelled`, abort through the run's `AbortController`) and Retry on failed ones. Clear teammate `error` on activate and after the next task. | `cancelled` exists in the schema, but nothing sets it. A runaway task can't be stopped. | `schema.ts:108`, `task.ts:55`, `teammate-view.tsx:216` | S–M |
| 2.4 | **Fix race conditions.** In `decide()`, change status (compare-and-set) **before** side effects. Dedupe REPORT tasks in `onTaskFinished`. Take the worker lock with `O_EXCL`. | Approving from the app and from WhatsApp at the same time creates duplicate "Go ahead" tasks, and children that finish together create duplicate reports. | `src/lib/approvals.ts:44-63`, `src/lib/manager.ts:88-121`, `src/lib/worker-lock.ts:34` | S |
| 2.5 | **Indexes, pruning and backups.** Index `activity_events(business_id,id)`, `jobs(status)`, `tasks(teammate_id,status)` and `approvals(business_id,status)`. Prune old events and jobs. Run a daily `VACUUM INTO backups/` with retention. Rotate `logs/`. | Each open tab polls an unbounded table every 700 ms over SSE. The only backups happen during migrations. | `drizzle/`, `api/b/[id]/events/route.ts`, `src/lib/migrate.ts` | S |
| 2.6 | **Test harness.** Vitest covering `checkFileAccess`, `cleanRel`, `secrets.hostAllowed/redact`, `isAllowedUrl`, the Indonesian yes/no parsing in `owner-approvals`, `normalizePhone`, `claimJob`/`requeueStaleJobs` on a temp `AJUDAN_DATA_DIR`, the migration row-loss guard, and the 1.2 resolver fixture. | There are no tests. These are pure, security-critical units. | new `tests/` | M |

## Milestone 3: A team that learns

| # | Item | Why | Where | Size |
|---|------|-----|-------|------|
| 3.1 | **Owner feedback loop.** On Work, replace "Mark approved/published" with "Looks good" and "Needs changes + note". The note (a) creates a revision task linked to the deliverable, (b) is added to the teammate's `memory.md`, and (c) is added to a shared `teammates/TEAM.md` of brand rules and preferences that every teammate reads next to `BUSINESS.md`. | Corrections are stored only as a status. Lessons stay in each teammate's own silo, so the social manager never hears what the owner told the copywriter. | `deliverables/actions.ts:13-34`, `src/lib/workspace.ts:61`, `task.ts:515,536` | M |
| 3.2 | **Conversation memory for every teammate.** Generalize `managerHistory` into a per-teammate rolling thread, or `resume` the saved `sessionId` for continuation tasks (`system:capability`, `system:reply`, `human:*`). | Only the manager remembers. Direct chats with a teammate, and "Go ahead" after a capability grant, start cold. | `task.ts:251,277` | S–M |
| 3.3 | **Quality gate.** Add `read_deliverable` and `update_deliverable` (with versions, not new rows). The REPORT prompt reviews the deliverable against the request and KPIs and sends back at most one revision. Add a checklist line per role in `roles.ts`. | The manager summarizes 1,200-char excerpts and never sees the actual work. | `worker/tools.ts:793`, `src/lib/manager.ts:110-120`, `src/lib/roles.ts` | M |
| 3.4 | **Delegation that reports back.** Set `parentTaskId` for every delegator and route the report to the delegator. Drop `growth_lead` or narrow it to "strategy, no delegation", since the manager already coordinates. Pass the owner's original message to delegates. Allow one level of sub-delegation. | The growth lead's weekly "plan and delegate" never hears back, and delegates only see the manager's paraphrase. | `tools.ts:627-642`, `manager.ts:77`, `team.ts:136`, `roles.ts:36` | M |
| 3.5 | **Scheduled work with continuity.** Build the scheduled prompt from the base prompt, the last scheduled result, deliverables since then, and open approvals. Log `schedule_skipped` as an event and show "next run / last skipped" on the card. Add a day/time picker instead of raw cron, with a minimum interval. | Each cron run starts blank. A stuck approval silently cancels next week's plan. | `worker/scheduler.ts:78-98`, `team/forms.tsx:95` | M |
| 3.6 | **Memory consolidation.** When `memory.md` passes N KB, have the fast model rewrite it into Preferences / Decisions / Lessons. | Each teammate reads its whole memory every run, and it is never trimmed. | `task.ts:515,536` | S |

## Milestone 4: Cost and control

| # | Item | Why | Where | Size |
|---|------|-----|-------|------|
| 4.1 | **Use `MODELS.fast`.** Run DECISION, REPORT, reply reminders and helpers on it. Let the manager handle trivial one-deliverable asks itself. Base `videoWork` on role or attachments, not a regex. Load the video plugin only for video work. | `MODELS.fast` is never called. A one-line caption takes at least 3 main-model runs, and any message that mentions "TikTok" gets an 80-turn, $6 budget. | `src/lib/claude.ts:21`, `task.ts:67,254-263` | S |
| 4.2 | **Daily budget per business.** Sum `tasks.costUsd`, enforce the cap at `claimJob`, cap delegation depth, and show weekly spend in the UI. | Budgets apply only per run, and schedules can spend quota unattended. | `src/lib/jobs.ts`, `task.ts:30,87` | S–M |
| 4.3 | **Jobs/health page.** Worker heartbeat, queue, failures and cost rollup. | The only observability is `console.log`. | new page | M |

## Milestone 5: Built for the Indonesian owner

| # | Item | Why | Where | Size |
|---|------|-----|-------|------|
| 5.1 | **Localize the UI.** Add a small `t()` keyed by `biz.language` for the nav, approvals, autonomy labels, badges and empty states. Default from `Accept-Language`, and set `<html lang>`. | The interviewer tells the owner, in Indonesian, to press an English "Finish interview" button. | `src/app/layout.tsx:55`, `src/lib/language.ts:16`, `schedule.ts:17` | S first pass → L |
| 5.2 | **WhatsApp setup checklist.** Show it on the manager page until `ownerHumanId` is set: link WhatsApp → your number (must be **different** from the linked one) → allowed chats. | Today this is a three-page hidden path, and the different-number requirement is never explained. | `profile/whatsapp-panel.tsx`, `team/page.tsx:135-179` | S |
| 5.3 | **Visible, editable team brief.** Show `persona` on the teammate card and allow editing it and the responsibilities. Add a "Check your profile" step before team design. "Redesign team" keeps manual edits and active teammates. | The owner can't see what each teammate was told, and redesign wipes their edits. | `team/actions.ts:26-122`, `worker/handlers/team.ts:27-64`, `onboarding.ts:146` | M |
| 5.4 | **Smaller fixes.** Human teammates get no office desk. The office "Give a task" form goes through the manager. `http_request` approvals get a readable card. The interview stays editable after finishing. | Inconsistencies found in the product audit. | `office/state.ts:28`, `office/task-form.tsx`, `approvals/page.tsx:237`, `onboarding/page.tsx:79` | S each |

## Milestone 6: Real channels and operations (after 1–5)

- **Real outward channels behind `request_capability`:** email (SMTP/Resend), Instagram and TikTok posting, Shopee and Tokopedia listings, Google Sheets. Each one upgrades `ready_to_post` to an actually published item, with approval. **L**
- **Operations role:** add an `operations_assistant` for orders, stock and invoices (Sheets/CSV through shell and `http_request`). Expand `customer_support` to answer WhatsApp customers with approval. **S** for the roles, **M** to make them good.

---

## Suggested order

1. **Week 1:** 1.1–1.6 plus 2.6 (the test harness, so later work has a safety net).
2. **Week 2:** 2.1–2.5.
3. **Week 3:** 3.1, 3.2, 4.1 (the biggest quality gains for the effort).
4. **Week 4:** 3.3–3.6, 4.2, 5.2.
5. **Then:** 5.1, 5.3, 4.3, Milestone 6.

Items within a milestone mostly touch different files and can run in parallel sessions. The exceptions are 1.1 and 3.3, which both edit `worker/tools.ts`, and 2.1 and 3.2, which both change resume and sessionId handling in `task.ts`. Run each of those pairs one after the other.

## Already solid (leave alone)

Files-route path traversal (`cleanRel` + realpath), migration safety (backup, row count, FK check), host-scoped secrets with `redirect: "manual"`, capability requests that never expose secrets, WhatsApp JID resolution before approval, human-teammate batching and voice transcription, and the "treat page/WhatsApp text as data" prompt rules.
