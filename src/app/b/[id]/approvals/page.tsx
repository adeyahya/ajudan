import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { and, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { CalendarClock, CircleDot, Clock, History, Inbox, MessageCircle, StickyNote, Type, User } from "lucide-react";
import { db, schema } from "@/db";
import type { Approval, Deliverable, Teammate } from "@/db/schema";
import { LiveRefresh } from "@/components/live";
import { ImageStrip } from "@/components/image-strip";
import { DataTable } from "@/components/data-table";
import { SidePeekLayout } from "@/components/side-peek";
import {
  Avatar,
  Badge,
  EmptyState,
  LineTabs,
  ListSkeleton,
  PageBody,
  PageHeader,
  PropertyList,
  Prose,
  Skeleton,
} from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { CAPABILITY, type CapabilityRequest } from "@/lib/capabilities";
import { describeHttpRequest } from "@/lib/http-approval";
import { isServablePath } from "@/lib/media";
import { statusTone } from "@/lib/status-tones";
import { t, uiLang, type UiLang } from "@/lib/i18n";
import { fullTime, kindLabel, relativeTime } from "../deliverables/format";
import { HistoryPeek } from "./history-peek";
import { InboxList, type InboxCard } from "./inbox-list";
import { approvalKind, KIND_META } from "./kinds";
import { TeamChanges } from "./team-changes";

type Props = PageProps<"/b/[id]/approvals">;

export default function ApprovalsPage(props: Props) {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

function InboxSkeleton() {
  return (
    <PageBody width="wide">
      <Skeleton className="h-[34px] w-40 rounded-md" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <Skeleton className="mt-10 h-8 w-64" />
      <div className="mt-6 max-w-3xl space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border p-4">
            <ListSkeleton rows={1} />
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-7 w-full rounded-md" />
          </div>
        ))}
      </div>
    </PageBody>
  );
}

async function loadApprovals(businessId: string) {
  await connection();
  const approvals = db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.businessId, businessId))
    .orderBy(desc(schema.approvals.createdAt))
    .limit(200)
    .all();
  const mates = db.select().from(schema.teammates).where(eq(schema.teammates.businessId, businessId)).all();
  const deliverableIds = approvals
    .map((a) => (typeof a.input.deliverable_id === "string" ? a.input.deliverable_id : null))
    .filter((x): x is string => !!x);
  const deliverables = deliverableIds.length
    ? db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.businessId, businessId), inArray(schema.deliverables.id, deliverableIds)))
        .all()
    : [];
  return { approvals, mates, deliverables: new Map(deliverables.map((d) => [d.id, d])) };
}

async function Content({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const view = one(sp.view) === "history" ? "history" : "inbox";
  const peekId = view === "history" ? one(sp.a) : undefined;
  const [biz, data] = await Promise.all([getBusiness(id), loadApprovals(id)]);
  if (!biz) notFound();
  const lang = uiLang(biz.language);
  const pending = data.approvals.filter((a) => a.status === "pending");
  const decided = data.approvals.filter((a) => a.status !== "pending");
  const mate = (tid: string) => data.mates.find((m) => m.id === tid);
  const owner = biz.ownerHumanId ? data.mates.find((m) => m.id === biz.ownerHumanId) : undefined;
  const base = `/b/${id}/approvals`;
  const peek = peekId ? decided.find((a) => a.id === peekId) : undefined;

  const cards: InboxCard[] = pending.map((a) => {
    const m = mate(a.teammateId);
    const cap = a.toolName === CAPABILITY ? (a.input as CapabilityRequest) : null;
    return {
      id: a.id,
      summary: a.summary,
      teammate: m ? { id: m.id, name: m.name, color: m.color, title: m.title } : undefined,
      when: relativeTime(a.createdAt, lang),
      whenFull: fullTime(a.createdAt, lang),
      kind: approvalKind(a.toolName),
      preview: <ApprovalPreview a={a} businessId={id} deliverables={data.deliverables} lang={lang} />,
      capability: cap ? { secret: cap.kind === "secret" ? { name: cap.name, hosts: cap.hosts } : undefined } : undefined,
    };
  });

  return (
    <SidePeekLayout
      peek={
        <HistoryPeek open={!!peek} title={peek ? t(lang, KIND_META[approvalKind(peek.toolName)].label) : undefined}>
          {peek && <HistoryDetail a={peek} teammate={mate(peek.teammateId)} businessId={id} deliverables={data.deliverables} lang={lang} />}
        </HistoryPeek>
      }
    >
      <PageBody width="wide">
        <LiveRefresh businessId={id} types={["approval_requested", "approval_granted", "approval_rejected", "task_done", "task_failed", "task_cancelled"]} />
        <PageHeader title={t(lang, "approvals.title")} description={t(lang, "approvals.description")} />
        <LineTabs
          label={t(lang, "approvals.title")}
          items={[
            { href: base, label: t(lang, "approvals.tab.needsYou"), active: view === "inbox", count: pending.length, icon: <Inbox /> },
            { href: `${base}?view=history`, label: t(lang, "approvals.history"), active: view === "history", icon: <History /> },
          ]}
        />

        {view === "inbox" ? (
          <div className="mt-4 max-w-3xl">
            {pending.length > 0 && (
              <p className="mb-4 flex items-start gap-1.5 text-xs text-tertiary">
                <MessageCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                {owner ? t(lang, "approvals.subtitleOwner", { name: owner.name }) : t(lang, "approvals.subtitleNoOwner")}
              </p>
            )}
            <InboxList
              businessId={id}
              cards={cards}
              empty={<EmptyState icon={<Inbox />} title={t(lang, "approvals.empty.title")} body={t(lang, "approvals.empty.body")} />}
            />
            <TeamChanges businessId={id} lang={lang} />
          </div>
        ) : (
          <DataTable<Approval>
            className="mt-1"
            rows={decided}
            getRowId={(a) => a.id}
            rowHref={(a) => `${base}?view=history&a=${a.id}`}
            selectedId={peek?.id}
            minWidth={660}
            label={t(lang, "approvals.history")}
            empty={<EmptyState icon={<History />} title={t(lang, "approvals.noDecisions")} body={t(lang, "approvals.noDecisions.body")} />}
            columns={[
              { key: "summary", header: t(lang, "approvals.col.summary"), icon: <Type />, title: (a) => a.summary, cell: (a) => a.summary },
              {
                key: "teammate",
                header: t(lang, "approvals.col.teammate"),
                icon: <User />,
                width: 136,
                title: (a) => mate(a.teammateId)?.name,
                cell: (a) => {
                  const m = mate(a.teammateId);
                  return m ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar seed={m.id} name={m.name} color={m.color} size={20} />
                      <span className="truncate">{m.name}</span>
                    </span>
                  ) : null;
                },
              },
              { key: "decision", header: t(lang, "approvals.col.decision"), icon: <CircleDot />, width: 108, cell: (a) => <DecisionBadge status={a.status} lang={lang} /> },
              {
                key: "when",
                header: t(lang, "approvals.col.when"),
                icon: <Clock />,
                width: 100,
                title: (a) => (a.decidedAt ? fullTime(a.decidedAt, lang) : undefined),
                cell: (a) => <span className="text-xs text-tertiary">{a.decidedAt ? relativeTime(a.decidedAt, lang) : "—"}</span>,
              },
              {
                key: "note",
                header: t(lang, "approvals.col.note"),
                icon: <StickyNote />,
                width: 160,
                title: (a) => a.note ?? undefined,
                cell: (a) => (a.note ? <span className="text-muted-foreground">{a.note}</span> : <span className="text-tertiary">—</span>),
              },
            ]}
          />
        )}
      </PageBody>
    </SidePeekLayout>
  );
}

function DecisionBadge({ status, lang }: { status: string; lang: UiLang }) {
  const s = statusTone("approval", status);
  return <Badge tone={s.tone}>{t(lang, s.label)}</Badge>;
}

/** History peek body: who asked, what, the decision and the full preview. */
function HistoryDetail({
  a,
  teammate,
  businessId,
  deliverables,
  lang,
}: {
  a: Approval;
  teammate?: Teammate;
  businessId: string;
  deliverables: Map<string, Deliverable>;
  lang: UiLang;
}) {
  const kind = KIND_META[approvalKind(a.toolName)];
  const Icon = kind.icon;
  return (
    <article className="space-y-5">
      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={kind.tone}>
            <Icon aria-hidden />
            {t(lang, kind.label)}
          </Badge>
          <DecisionBadge status={a.status} lang={lang} />
        </div>
        <h2 className="text-xl leading-7 font-semibold tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">{a.summary}</h2>
      </header>
      <PropertyList
        items={[
          ...(teammate
            ? [
                {
                  icon: <User />,
                  label: t(lang, "approvals.col.teammate"),
                  value: (
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar seed={teammate.id} name={teammate.name} color={teammate.color} size={20} />
                      <span className="truncate">
                        {teammate.name} <span className="text-tertiary">· {teammate.title}</span>
                      </span>
                    </span>
                  ),
                },
              ]
            : []),
          { icon: <CalendarClock />, label: t(lang, "approvals.col.asked"), value: fullTime(a.createdAt, lang) },
          ...(a.decidedAt ? [{ icon: <Clock />, label: t(lang, "approvals.col.when"), value: fullTime(a.decidedAt, lang) }] : []),
          ...(a.note ? [{ icon: <StickyNote />, label: t(lang, "approvals.yourNote"), value: <span className="whitespace-pre-wrap">{a.note}</span> }] : []),
        ]}
      />
      <ApprovalPreview a={a} businessId={businessId} deliverables={deliverables} lang={lang} />
    </article>
  );
}

/** The muted box a preview sits in (13px). */
function Box({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-2 rounded-md bg-muted p-3 text-[13px] leading-5 text-foreground ${className ?? ""}`}>{children}</div>;
}

function BoxLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{children}</div>;
}

/** An outgoing chat bubble (WhatsApp previews). */
function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto w-fit max-w-[90%] rounded-lg rounded-tr-sm bg-background px-3 py-2 shadow-sm ring-1 ring-black/5">{children}</div>
  );
}

const compact = "text-[13px] leading-5";

/** Human-friendly view of what the teammate wants to do. */
function ApprovalPreview({
  a,
  businessId,
  deliverables,
  lang,
}: {
  a: Approval;
  businessId: string;
  deliverables: Map<string, Deliverable>;
  lang: UiLang;
}) {
  const i = a.input as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? "" : String(v));
  if (a.toolName === CAPABILITY) {
    const r = a.input as CapabilityRequest;
    return (
      <Box>
        <p>
          <span className="text-muted-foreground">{t(lang, "approvals.why")} </span>
          {r.why}
        </p>
        {r.kind === "shell" && <p className="text-xs text-muted-foreground">{t(lang, "approvals.shellSandbox")}</p>}
        {r.kind === "mcp" && !r.existing && (
          <>
            <BoxLabel>{t(lang, r.transport === "stdio" ? "approvals.mcp.runs" : "approvals.mcp.connects")}</BoxLabel>
            <code className="block rounded-md border border-border bg-background p-2 font-mono text-xs break-all">
              {r.transport === "stdio" ? [r.command, ...(r.args ?? [])].join(" ") : r.url}
              {Object.entries({ ...r.env, ...r.headers }).map(([k, v]) => (
                <span key={k} className="block text-muted-foreground">
                  {k}: {v}
                </span>
              ))}
            </code>
            <p className="text-xs text-muted-foreground">{t(lang, r.transport === "stdio" ? "approvals.mcp.stdioWarn" : "approvals.mcp.httpNote")}</p>
          </>
        )}
      </Box>
    );
  }
  if (a.toolName === "mcp__github__create_issues") {
    const issues = (Array.isArray(i.issues) ? i.issues : []) as { title?: string; body?: string; labels?: string[] }[];
    return (
      <Box>
        <BoxLabel>
          {t(lang, "approvals.gh.issuesIn")} <span className="font-medium text-foreground">{str(i.repo)}</span> · {issues.length}
        </BoxLabel>
        <ol className="max-h-[28rem] space-y-3 overflow-y-auto">
          {issues.map((x, n) => (
            <li key={n} className="rounded-md border border-border bg-background p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">{str(x.title)}</span>
                {(x.labels ?? []).map((l) => (
                  <Badge key={l}>{l}</Badge>
                ))}
              </div>
              {x.body ? <Prose className={`mt-1 ${compact}`}>{str(x.body)}</Prose> : null}
            </li>
          ))}
        </ol>
      </Box>
    );
  }
  if (a.toolName === "mcp__github__comment_issue") {
    return (
      <Box>
        <BoxLabel>
          {t(lang, "approvals.gh.commentOn")} <span className="font-medium text-foreground">{str(i.repo)} #{str(i.number)}</span>
        </BoxLabel>
        <Prose className={compact}>{str(i.body)}</Prose>
      </Box>
    );
  }
  // Check WhatsApp first: its send_message would also match the old biz send_message rule below.
  if (a.toolName === "mcp__whatsapp__update_group") {
    return (
      <Box>
        <BoxLabel>
          {t(lang, "approvals.wa.updateGroup")} <span className="font-medium text-foreground">{str(i.chat)}</span>
        </BoxLabel>
        {i.name ? (
          <div>
            {t(lang, "approvals.wa.newName")} <b className="font-semibold">{str(i.name)}</b>
          </div>
        ) : null}
        {i.admins_only !== undefined ? <div>{i.admins_only ? t(lang, "approvals.wa.adminsOnly") : t(lang, "approvals.wa.everyone")}</div> : null}
        {i.description !== undefined ? <Prose className={compact}>{str(i.description)}</Prose> : null}
      </Box>
    );
  }
  if (a.toolName === "mcp__whatsapp__create_group") {
    return (
      <Box>
        <BoxLabel>
          {t(lang, "approvals.wa.newGroup")}
          {i.announce_only ? ` · ${t(lang, "approvals.wa.newGroupAdminsOnly")}` : ""}
        </BoxLabel>
        <div className="font-semibold">{str(i.name)}</div>
        {i.description ? <Prose className={compact}>{str(i.description)}</Prose> : null}
      </Box>
    );
  }
  if (a.toolName.startsWith("mcp__whatsapp__send_")) {
    // send_file's path is inside the teammate's folder; work/ and media/ are the same files as in the business folder.
    const file = str(i.file);
    const text = str(i.message ?? i.caption ?? "");
    return (
      <Box>
        <BoxLabel>
          WhatsApp →{" "}
          <span className="font-medium text-foreground">
            {Array.isArray(i.recipientNames) ? (i.recipientNames as string[]).join(", ") : str(i.chat)}
          </span>
          {file ? ` · ${t(lang, "approvals.wa.file", { file })}` : ""}
        </BoxLabel>
        <Bubble>
          {file && isServablePath(file) && <ImageStrip businessId={businessId} images={[file]} size={120} className="mb-1.5" />}
          {text && <Prose className={compact}>{text}</Prose>}
        </Bubble>
      </Box>
    );
  }
  // Old rows from before 1.1: the biz send_message and publish_deliverable tools no longer exist.
  if (a.toolName.endsWith("__send_message")) {
    return (
      <Box>
        <BoxLabel>
          {str(i.channel)} → <span className="font-medium text-foreground">{str(i.to)}</span>
        </BoxLabel>
        <div className="font-semibold">{str(i.subject)}</div>
        <Prose className={compact}>{str(i.body)}</Prose>
      </Box>
    );
  }
  if (a.toolName.endsWith("__confirm_browser_action")) {
    return (
      <Box>
        <BoxLabel>
          {t(lang, "approvals.browserOn")} <span className="font-medium text-foreground">{str(i.site)}</span>
        </BoxLabel>
        <div className="font-semibold">{str(i.action)}</div>
        <Prose className={compact}>{str(i.details)}</Prose>
      </Box>
    );
  }
  if (a.toolName.endsWith("__http_request")) {
    const r = describeHttpRequest(i);
    return (
      <Box>
        <BoxLabel>
          {t(lang, "approvals.http.callTo")} <span className="font-medium text-foreground">{r.host || t(lang, "approvals.http.invalidUrl")}</span>
          {r.secrets.length > 0 && (
            <>
              {" "}
              · {t(lang, "approvals.http.uses")}{" "}
              {r.secrets.map((s) => (
                <Badge key={s} tone="yellow" className="font-mono">
                  {s}
                </Badge>
              ))}
            </>
          )}
        </BoxLabel>
        <div className="flex items-start gap-2">
          <Badge tone="blue" className="font-mono">
            {r.method}
          </Badge>
          <code className="min-w-0 pt-0.5 font-mono text-xs break-all">{r.url}</code>
        </div>
        {r.headers.length > 0 && (
          <div className="space-y-0.5 font-mono text-xs text-muted-foreground">
            {r.headers.map(([k, v]) => (
              <div key={k} className="break-all">
                <span className="text-foreground">{k}:</span> {v}
              </div>
            ))}
          </div>
        )}
        {r.bodyPreview && (
          <pre className="max-h-60 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-xs leading-[18px]">
            {r.bodyPreview}
            {r.bodyTruncated ? "\n…" : ""}
          </pre>
        )}
        {r.saveAs && <div className="text-xs text-muted-foreground">{t(lang, "approvals.http.savedAs", { file: r.saveAs })}</div>}
        <p className="text-xs text-muted-foreground">
          {r.method === "GET" || r.method === "HEAD" ? t(lang, "approvals.http.reads") : t(lang, "approvals.http.changes")}{" "}
          {t(lang, "approvals.http.secretsNote")}
        </p>
      </Box>
    );
  }
  if (a.toolName.endsWith("__publish_deliverable")) {
    const d = deliverables.get(str(i.deliverable_id));
    return (
      <Box>
        <BoxLabel>
          {t(lang, "approvals.publishTo")} <span className="font-medium text-foreground">{str(i.channel)}</span>
          {d ? ` · ${kindLabel(d.kind)}` : ""}
        </BoxLabel>
        {d ? (
          <>
            <div className="font-semibold">{d.title}</div>
            <ImageStrip businessId={businessId} images={d.attachments} size={96} />
            <Prose className={`max-h-80 overflow-y-auto ${compact}`}>{d.content}</Prose>
          </>
        ) : (
          <p className="text-muted-foreground">{t(lang, "approvals.deliverableMissing", { id: str(i.deliverable_id) })}</p>
        )}
      </Box>
    );
  }
  if (Object.keys(i).length === 0) return null;
  return (
    <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-[18px]">{JSON.stringify(i, null, 2)}</pre>
  );
}
