import { notFound } from "next/navigation";
import { Suspense } from "react";
import { desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { Approval, Deliverable } from "@/db/schema";
import { LiveRefresh } from "@/components/live";
import { Avatar, Badge, Button, Card, Input, PageHeader, PageSkeleton, Prose } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { decideApproval } from "./actions";

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

  return (
    <div className="space-y-8">
      <LiveRefresh businessId={id} types={["approval_requested", "approval_granted", "approval_rejected", "task_done", "task_failed"]} />
      <PageHeader
        title="Approvals"
        subtitle="Teammates with “ask” autonomy wait here before publishing or sending anything outside the business."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Waiting for you ({pending.length})</h2>
        {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs your approval right now.</p>}
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
                    {a.createdAt.toLocaleString()}
                  </div>
                </div>
                <Badge tone="amber">pending</Badge>
              </div>
              <ApprovalInput a={a} deliverables={data.deliverables} />
              <form action={decideApproval} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="businessId" value={id} />
                <input type="hidden" name="approvalId" value={a.id} />
                <Input name="note" placeholder="Optional note for the teammate" className="flex-1 min-w-48" />
                <Button name="decision" value="approved">
                  Approve
                </Button>
                <Button name="decision" value="rejected" variant="secondary">
                  Reject
                </Button>
              </form>
            </Card>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">History</h2>
        {decided.length === 0 && <p className="text-sm text-muted-foreground">No decisions yet.</p>}
        {decided.map((a) => {
          const m = mate(a.teammateId);
          return (
            <details key={a.id} className="group rounded-xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                {m && <Avatar seed={m.id} name={m.name} color={m.color} size={26} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{a.summary}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.decidedAt ? `Decided ${a.decidedAt.toLocaleString()}` : ""}
                    {a.note ? ` · “${a.note}”` : ""}
                  </div>
                </div>
                <Badge tone={a.status === "approved" ? "green" : "red"}>{a.status}</Badge>
              </summary>
              <div className="border-t border-border p-3">
                <ApprovalInput a={a} deliverables={data.deliverables} />
              </div>
            </details>
          );
        })}
      </section>
    </div>
  );
}

/** Human-friendly view of what the teammate wants to do. */
function ApprovalInput({ a, deliverables }: { a: Approval; deliverables: Map<string, Deliverable> }) {
  const i = a.input as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? "" : String(v));
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
          In the business browser on <span className="text-foreground">{str(i.site)}</span>
        </div>
        <div className="font-medium">{str(i.action)}</div>
        <Prose>{str(i.details)}</Prose>
      </div>
    );
  }
  if (a.toolName.endsWith("__publish_deliverable")) {
    const d = deliverables.get(str(i.deliverable_id));
    return (
      <div className="rounded-lg border border-border bg-background/50 p-3 space-y-1 text-sm">
        <div className="text-xs text-muted-foreground">
          Publish to <span className="text-foreground">{str(i.channel)}</span>
          {d ? ` · ${d.kind.replace(/_/g, " ")}` : ""}
        </div>
        {d ? (
          <>
            <div className="font-medium">{d.title}</div>
            <Prose className="max-h-80 overflow-y-auto">{d.content}</Prose>
          </>
        ) : (
          <p className="text-muted-foreground">Deliverable {str(i.deliverable_id)} not found.</p>
        )}
      </div>
    );
  }
  return (
    <pre className="rounded-lg border border-border p-3 text-xs overflow-x-auto">{JSON.stringify(i, null, 2)}</pre>
  );
}
