import type { Deliverable, DeliverableStatus } from "@/db/schema";
import { Avatar, Badge, Button, Prose } from "@/components/kit";
import { markPosted } from "./actions";
import { CopyButton } from "./copy-button";
import { FeedbackForm } from "./feedback-form";
import { ImageStrip } from "@/components/image-strip";
import { dateLocale, t, type UiLang } from "@/lib/i18n";

export const DELIVERABLE_TONE: Record<DeliverableStatus, "neutral" | "green" | "blue" | "amber" | "red"> = {
  draft: "neutral",
  ready_to_post: "amber",
  approved: "blue",
  published: "green",
  rejected: "red",
};

/** "published" stays the stored value for work the owner posted (and old simulated publishes): "Posted". */
export function deliverableLabel(status: DeliverableStatus, lang?: string | null) {
  return t(lang, `deliverableStatus.${status}`);
}

export function kindLabel(kind: string) {
  return kind.replace(/_/g, " ");
}

/** One deliverable with expandable content, Copy, Mark posted and the owner's feedback. */
export function DeliverableCard({
  d,
  teammate,
  revisingBy,
  showActions = true,
  lang,
}: {
  d: Deliverable;
  teammate?: { id: string; name: string; color: string } | null;
  /** Who is revising it right now (an open revision task), if anyone. */
  revisingBy?: string | null;
  showActions?: boolean;
  lang: UiLang;
}) {
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
            {teammate ? ` · ${teammate.name}` : ""} · {d.createdAt.toLocaleString(dateLocale(lang))}
            {d.versions.length > 0 ? ` · ${t(lang, "work.version", { n: d.versions.length + 1 })}` : ""}
          </div>
        </div>
        {d.attachments.length > 0 && (
          <span className="font-pixel text-xs text-muted-foreground">🖼 {d.attachments.length}</span>
        )}
        <Badge tone={DELIVERABLE_TONE[d.status]}>{deliverableLabel(d.status, lang)}</Badge>
        <span className="text-muted-foreground text-xs transition group-open:rotate-90">▶</span>
      </summary>
      <div className="border-t border-border p-3 space-y-3">
        {d.status === "ready_to_post" && (
          <p className="text-xs text-muted-foreground">
            {t(lang, isMessage ? "work.readySend" : "work.readyPost", {
              on: d.channel ? t(lang, "work.readyOn", { channel: d.channel }) : "",
              files: d.attachments.length ? t(lang, "work.readyFiles") : "",
            })}
          </p>
        )}
        {revisingBy && <p className="text-xs text-muted-foreground">{t(lang, "work.revising", { name: revisingBy })}</p>}
        <ImageStrip businessId={d.businessId} images={d.attachments} size={120} />
        <Prose className="max-h-[28rem] overflow-y-auto">{d.content}</Prose>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={d.content} />
          {showActions && (d.status === "ready_to_post" || d.status === "approved") && (
            <form action={markPosted}>
              <input type="hidden" name="businessId" value={d.businessId} />
              <input type="hidden" name="deliverableId" value={d.id} />
              <Button variant="secondary" className="h-7 px-2.5 text-xs">
                {isMessage ? t(lang, "work.markSent") : t(lang, "work.markPosted")}
              </Button>
            </form>
          )}
        </div>
        {showActions && <FeedbackForm businessId={d.businessId} deliverableId={d.id} canRevise={d.status !== "published"} />}
      </div>
    </details>
  );
}
