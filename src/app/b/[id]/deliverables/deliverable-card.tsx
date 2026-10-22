import type { Deliverable, DeliverableStatus } from "@/db/schema";
import { Avatar, Badge, Button, Prose } from "@/components/kit";
import { setDeliverableStatus } from "./actions";
import { CopyButton } from "./copy-button";
import { ImageStrip } from "@/components/image-strip";

export const DELIVERABLE_TONE: Record<DeliverableStatus, "neutral" | "green" | "blue" | "amber" | "red"> = {
  draft: "neutral",
  ready_to_post: "amber",
  approved: "blue",
  published: "green",
  rejected: "red",
};

/** "published" stays the stored value for work the owner posted (and old simulated publishes). */
export const DELIVERABLE_LABEL: Record<DeliverableStatus, string> = {
  draft: "Draft",
  ready_to_post: "Ready to post",
  approved: "Approved",
  published: "Posted",
  rejected: "Rejected",
};

export function kindLabel(kind: string) {
  return kind.replace(/_/g, " ");
}

/** One deliverable with expandable content, Copy and status actions. */
export function DeliverableCard({
  d,
  teammate,
  showActions = true,
}: {
  d: Deliverable;
  teammate?: { id: string; name: string; color: string } | null;
  showActions?: boolean;
}) {
  const actions: { status: DeliverableStatus; label: string; variant: "secondary" | "ghost" }[] = [
    { status: "approved", label: "Mark approved", variant: "secondary" },
    { status: "published", label: "Mark posted", variant: "secondary" },
    { status: "rejected", label: "Reject", variant: "ghost" },
  ];
  const isMessage = d.kind === "outbound_message";
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
        {teammate && <Avatar seed={teammate.id} name={teammate.name} color={teammate.color} size={26} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{d.title}</div>
          <div className="text-xs text-muted-foreground">
            {kindLabel(d.kind)}
            {d.channel ? ` · ${d.channel}` : ""}
            {teammate ? ` · ${teammate.name}` : ""} · {d.createdAt.toLocaleString()}
          </div>
        </div>
        {d.attachments.length > 0 && (
          <span className="font-pixel text-xs text-muted-foreground">🖼 {d.attachments.length}</span>
        )}
        <Badge tone={DELIVERABLE_TONE[d.status]}>{DELIVERABLE_LABEL[d.status]}</Badge>
        <span className="text-muted-foreground text-xs transition group-open:rotate-90">▶</span>
      </summary>
      <div className="border-t border-border p-3 space-y-3">
        {d.status === "ready_to_post" && (
          <p className="text-xs text-muted-foreground">
            {isMessage ? "Ready for you to send" : "Ready for you to post"}
            {d.channel ? ` on ${d.channel}` : ""}: Ajudan doesn&apos;t {isMessage ? "send" : "post"} it. Copy the text
            {d.attachments.length ? ", download the files" : ""} and {isMessage ? "send" : "post"} it yourself, then mark it posted.
          </p>
        )}
        <ImageStrip businessId={d.businessId} images={d.attachments} size={120} />
        <Prose className="max-h-[28rem] overflow-y-auto">{d.content}</Prose>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={d.content} />
          {showActions &&
            actions
              .filter((a) => a.status !== d.status)
              .map((a) => (
                <form key={a.status} action={setDeliverableStatus}>
                  <input type="hidden" name="businessId" value={d.businessId} />
                  <input type="hidden" name="deliverableId" value={d.id} />
                  <input type="hidden" name="status" value={a.status} />
                  <Button variant={a.variant} className="h-7 px-2.5 text-xs">
                    {a.label}
                  </Button>
                </form>
              ))}
        </div>
      </div>
    </details>
  );
}
