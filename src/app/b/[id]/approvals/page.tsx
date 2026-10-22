import { notFound } from "next/navigation";
import { Suspense } from "react";
import { desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { Approval, Deliverable } from "@/db/schema";
import { LiveRefresh } from "@/components/live";
import { ImageStrip } from "@/components/image-strip";
import { Avatar, Badge, Button, Card, Input, PageHeader, PageSkeleton, Prose } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { CAPABILITY, type CapabilityRequest } from "@/lib/capabilities";
import { describeHttpRequest } from "@/lib/http-approval";
import { isServablePath } from "@/lib/media";
import { dateLocale, t, uiLang, type UiLang } from "@/lib/i18n";
import { approveCapability, decideApproval, rejectCapability } from "./actions";
import { CapabilityForm } from "./capability-form";

type Params = { params: Promise<{ id: string }> };

export default function ApprovalsPage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
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
    ? db.select().from(schema.deliverables).where(inArray(schema.deliverables.id, deliverableIds)).all()
    : [];
  return { approvals, mates, deliverables: new Map(deliverables.map((d) => [d.id, d])) };
}

async function Content({ params }: Params) {
  const { id } = await params;
  const [biz, data] = await Promise.all([getBusiness(id), loadApprovals(id)]);
  if (!biz) notFound();
  const pending = data.approvals.filter((a) => a.status === "pending");
  const decided = data.approvals.filter((a) => a.status !== "pending");
  const mate = (tid: string) => data.mates.find((m) => m.id === tid);
  const owner = biz.ownerHumanId ? data.mates.find((m) => m.id === biz.ownerHumanId) : undefined;
  const lang = uiLang(biz.language);

  return (
    <div className="space-y-8">
      <LiveRefresh businessId={id} types={["approval_requested", "approval_granted", "approval_rejected", "task_done", "task_failed", "task_cancelled"]} />
      <PageHeader
        title={t(lang, "approvals.title")}
        subtitle={`${t(lang, "approvals.subtitle")} ${owner ? t(lang, "approvals.subtitleOwner", { name: owner.name }) : t(lang, "approvals.subtitleNoOwner")}`}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t(lang, "approvals.waiting", { count: pending.length })}</h2>
        {pending.length === 0 && <p className="text-sm text-muted-foreground">{t(lang, "approvals.nothing")}</p>}
        {pending.map((a) => {
          const m = mate(a.teammateId);
          return (
            <Card key={a.id} className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                {m && <Avatar seed={m.id} name={m.name} color={m.color} />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.summary}</div>
                  <div className="text-xs text-muted-foreground">
                    {m ? `${m.name} · ${m.title} · ` : ""}
                    {a.createdAt.toLocaleString(dateLocale(lang))}
                  </div>
                </div>
                <Badge tone="amber">{t(lang, "approvalStatus.pending")}</Badge>
              </div>
              {a.toolName === CAPABILITY ? (
                <CapabilityRequestView a={a} businessId={id} lang={lang} />
              ) : (
              <>
              <ApprovalInput a={a} businessId={id} deliverables={data.deliverables} lang={lang} />
              <form action={decideApproval} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="businessId" value={id} />
                <input type="hidden" name="approvalId" value={a.id} />
                <Input name="note" placeholder={t(lang, "approvals.notePlaceholder")} className="flex-1 min-w-48" />
                <Button name="decision" value="approved">
                  {t(lang, "approvals.approve")}
                </Button>
                <Button name="decision" value="rejected" variant="secondary">
                  {t(lang, "approvals.reject")}
                </Button>
              </form>
              </>
              )}
            </Card>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t(lang, "approvals.history")}</h2>
        {decided.length === 0 && <p className="text-sm text-muted-foreground">{t(lang, "approvals.noDecisions")}</p>}
        {decided.map((a) => {
          const m = mate(a.teammateId);
          return (
            <details key={a.id} className="group rounded-xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                {m && <Avatar seed={m.id} name={m.name} color={m.color} size={26} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{a.summary}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.decidedAt ? t(lang, "approvals.decided", { when: a.decidedAt.toLocaleString(dateLocale(lang)) }) : ""}
                    {a.note ? ` · “${a.note}”` : ""}
                  </div>
                </div>
                <Badge tone={a.status === "approved" ? "green" : a.status === "rejected" ? "red" : "neutral"}>{t(lang, `approvalStatus.${a.status}`)}</Badge>
              </summary>
              <div className="border-t border-border p-3">
                <ApprovalInput a={a} businessId={id} deliverables={data.deliverables} lang={lang} />
              </div>
            </details>
          );
        })}
      </section>
    </div>
  );
}

/** A teammate asks for an ability it's missing (src/lib/capabilities.ts). */
function CapabilityRequestView({ a, businessId, lang }: { a: Approval; businessId: string; lang: UiLang }) {
  const r = a.input as CapabilityRequest;
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        <span className="text-muted-foreground">{t(lang, "approvals.why")} </span>
        {r.why}
      </p>
      {r.kind === "shell" && (
        <p className="text-xs text-muted-foreground">
          {t(lang, "approvals.shellSandbox")}
        </p>
      )}
      <CapabilityForm
        approve={approveCapability.bind(null, businessId, a.id)}
        reject={rejectCapability.bind(null, businessId, a.id)}
        secret={r.kind === "secret" ? { name: r.name, hosts: r.hosts } : undefined}
      />
    </div>
  );
}

/** Human-friendly view of what the teammate wants to do. */
function ApprovalInput({
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
  // Check WhatsApp first: its send_message would also match the old biz send_message rule below.
  if (a.toolName === "mcp__whatsapp__update_group") {
    return (
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1 text-sm">
        <div className="text-xs text-muted-foreground">
          {t(lang, "approvals.wa.updateGroup")} <span className="text-foreground">{str(i.chat)}</span>
        </div>
        {i.name ? <div>{t(lang, "approvals.wa.newName")} <b>{str(i.name)}</b></div> : null}
        {i.admins_only !== undefined ? <div>{i.admins_only ? t(lang, "approvals.wa.adminsOnly") : t(lang, "approvals.wa.everyone")}</div> : null}
        {i.description !== undefined ? <Prose>{str(i.description)}</Prose> : null}
      </div>
    );
  }
  if (a.toolName === "mcp__whatsapp__create_group") {
    return (
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1 text-sm">
        <div className="text-xs text-muted-foreground">
          {t(lang, "approvals.wa.newGroup")}
          {i.announce_only ? ` · ${t(lang, "approvals.wa.newGroupAdminsOnly")}` : ""}
        </div>
        <div className="font-medium">{str(i.name)}</div>
        {i.description ? <Prose>{str(i.description)}</Prose> : null}
      </div>
    );
  }
  if (a.toolName.startsWith("mcp__whatsapp__send_")) {
    // send_file's path is inside the teammate's folder; work/ and media/ are the same files as in the business folder.
    const file = str(i.file);
    return (
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1 text-sm">
        <div className="text-xs text-muted-foreground">
          WhatsApp →{" "}
          <span className="text-foreground">
            {Array.isArray(i.recipientNames) ? (i.recipientNames as string[]).join(", ") : str(i.chat)}
          </span>
          {file ? ` · ${t(lang, "approvals.wa.file", { file })}` : ""}
        </div>
        {file && isServablePath(file) && <ImageStrip businessId={businessId} images={[file]} size={120} className="pt-1" />}
        <Prose>{str(i.message ?? i.caption ?? "")}</Prose>
      </div>
    );
  }
  // Old rows from before 1.1: the biz send_message and publish_deliverable tools no longer exist.
  if (a.toolName.endsWith("__send_message")) {
    return (
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1 text-sm">
        <div className="text-xs text-muted-foreground">
          {str(i.channel)} → <span className="text-foreground">{str(i.to)}</span>
        </div>
        <div className="font-medium">{str(i.subject)}</div>
        <Prose>{str(i.body)}</Prose>
      </div>
    );
  }
  if (a.toolName.endsWith("__confirm_browser_action")) {
    return (
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1 text-sm">
        <div className="text-xs text-muted-foreground">
          {t(lang, "approvals.browserOn")} <span className="text-foreground">{str(i.site)}</span>
        </div>
        <div className="font-medium">{str(i.action)}</div>
        <Prose>{str(i.details)}</Prose>
      </div>
    );
  }
  if (a.toolName.endsWith("__http_request")) {
    const r = describeHttpRequest(i);
    return (
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2 text-sm">
        <div className="text-xs text-muted-foreground">
          {t(lang, "approvals.http.callTo")} <span className="text-foreground">{r.host || t(lang, "approvals.http.invalidUrl")}</span>
          {r.secrets.length > 0 && (
            <>
              {" "}
              · {t(lang, "approvals.http.uses")}{" "}
              {r.secrets.map((s) => (
                <Badge key={s} tone="amber">
                  {s}
                </Badge>
              ))}
            </>
          )}
        </div>
        <div className="flex items-start gap-2">
          <Badge tone="blue">{r.method}</Badge>
          <code className="min-w-0 break-all text-xs">{r.url}</code>
        </div>
        {r.headers.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {r.headers.map(([k, v]) => (
              <div key={k} className="break-all">
                <span className="text-foreground">{k}:</span> {v}
              </div>
            ))}
          </div>
        )}
        {r.bodyPreview && (
          <pre className="max-h-60 overflow-auto rounded-md border border-border p-2 text-xs">
            {r.bodyPreview}
            {r.bodyTruncated ? "\n…" : ""}
          </pre>
        )}
        {r.saveAs && <div className="text-xs text-muted-foreground">{t(lang, "approvals.http.savedAs", { file: r.saveAs })}</div>}
        <p className="text-xs text-muted-foreground">
          {r.method === "GET" || r.method === "HEAD" ? t(lang, "approvals.http.reads") : t(lang, "approvals.http.changes")}{" "}
          {t(lang, "approvals.http.secretsNote")}
        </p>
      </div>
    );
  }
  if (a.toolName.endsWith("__publish_deliverable")) {
    const d = deliverables.get(str(i.deliverable_id));
    return (
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1 text-sm">
        <div className="text-xs text-muted-foreground">
          {t(lang, "approvals.publishTo")} <span className="text-foreground">{str(i.channel)}</span>
          {d ? ` · ${d.kind.replace(/_/g, " ")}` : ""}
        </div>
        {d ? (
          <>
            <div className="font-medium">{d.title}</div>
            <ImageStrip businessId={businessId} images={d.attachments} size={120} className="pt-1" />
            <Prose className="max-h-80 overflow-y-auto">{d.content}</Prose>
          </>
        ) : (
          <p className="text-muted-foreground">{t(lang, "approvals.deliverableMissing", { id: str(i.deliverable_id) })}</p>
        )}
      </div>
    );
  }
  return (
    <pre className="rounded-lg border border-border p-3 text-xs overflow-x-auto">{JSON.stringify(i, null, 2)}</pre>
  );
}
