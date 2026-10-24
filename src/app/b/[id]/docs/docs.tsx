"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeft, FileTextIcon, ImageIcon, Info, Paperclip, PlusIcon, Trash2, UserRoundPlus, VideoIcon, XIcon } from "lucide-react";
import { DocLayoutButtons, useDocLayout } from "@/components/doc-layout";
import { TopBarActions } from "@/components/breadcrumb";
import { useT, useTn } from "@/components/i18n";
import { Badge, Button, cn, EmptyState, IconButton, Input, Kbd, LineTabs, Textarea } from "@/components/kit";
import { Markdown } from "@/components/markdown";
import { SidePeek } from "@/components/side-peek";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Deliverable, DeliverableStatus } from "@/db/schema";
import type { MessageKey } from "@/lib/i18n";
import type { MediaKind } from "@/lib/media-types";
import { statusTone } from "@/lib/status-tones";
import { fileUrl } from "@/components/image-strip";
import { PlanTask } from "@/components/plan-task";
import { DeleteDialog, localizeError, MoreMenu, PropRow, Segmented, WorkspaceShell } from "@/components/workspace-ui";
import { deleteDoc, saveDoc } from "./actions";

const KINDS = ["note", "brief", "plan", "script", "social_post", "blog_post", "email", "ad_copy", "report", "faq", "price_list"];
const STATUS: DeliverableStatus[] = ["draft", "approved", "published", "rejected"];
/** The English label of a kind nobody translated (kinds the team invented): "case_study" → "Case study". */
const label = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Mate = { id: string; name: string; title: string; kind: string };
type MediaOption = { path: string; name: string; kind: MediaKind };
export type DocsFilter = "all" | "mine" | "team";

function useKindLabel() {
  const t = useT();
  return (k: string) => (KINDS.includes(k) ? t(`studio.docs.kind.${k}` as MessageKey) : label(k));
}

/** Write briefs, notes and scripts, and edit the team's drafts; hand any doc to a teammate for later. */
/** A list row: no full text, just its start for the search box. */
export type DocRow = Pick<Deliverable, "id" | "title" | "kind" | "status" | "teammateId"> & { excerpt: string };

export function Docs({
  businessId,
  docs,
  doc,
  docId,
  filter,
  teammates,
  media,
}: {
  businessId: string;
  docs: DocRow[];
  /** The open doc, in full. */
  doc?: Deliverable;
  docId?: string;
  filter: DocsFilter;
  teammates: Mate[];
  media: MediaOption[];
}) {
  const t = useT();
  const kindLabel = useKindLabel();
  const [q, setQ] = useState("");
  const [hand, setHand] = useState<{ key: string; text: string; attachments: string[] } | null>(null);
  // Focus mode hides the list: the doc takes the whole width.
  const { focus } = useDocLayout();
  const names = useMemo(() => new Map(teammates.map((m) => [m.id, m.name])), [teammates]);
  const shown = docs.filter((d) => {
    if (filter === "mine" && d.teammateId) return false;
    if (filter === "team" && !d.teammateId) return false;
    const s = q.trim().toLowerCase();
    return !s || `${d.title} ${d.kind} ${d.excerpt}`.toLowerCase().includes(s);
  });
  const base = `/b/${businessId}/docs`;
  const href = (f: DocsFilter, id?: string) => {
    const p = new URLSearchParams();
    if (f !== "all") p.set("who", f);
    if (id) p.set("doc", id);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  const peek = (
    <SidePeek open={!!hand} onClose={() => setHand(null)} title={t("studio.docs.handTitle")} description={t("studio.docs.handHelp")}>
      {hand && (
        <div className="space-y-4">
          <PlanTask
            key={hand.key}
            businessId={businessId}
            teammates={teammates.filter((m) => m.kind === "ai")}
            attachments={hand.attachments}
            defaultText={hand.text}
            onDone={() => setHand(null)}
          />
        </div>
      )}
    </SidePeek>
  );

  return (
    <WorkspaceShell title={t("nav.docs")} peek={peek}>
      <TopBarActions>
        <DocLayoutButtons />
      </TopBarActions>
      <div className={cn("grid gap-8", !focus && "@3xl:grid-cols-[260px_minmax(0,1fr)]")}>
        <aside className={cn("min-w-0 space-y-3", doc && "hidden @3xl:block", focus && "hidden @3xl:hidden")}>
          <div className="flex items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("studio.docs.search")} aria-label={t("studio.docs.search")} className="h-7 min-w-0 flex-1 text-[13px]" />
            <Button asChild size="sm">
              <Link href={href(filter)}>
                <PlusIcon /> {t("studio.docs.new")}
              </Link>
            </Button>
          </div>
          <LineTabs
            label={t("studio.docs.filter")}
            items={(["all", "mine", "team"] as const).map((f) => ({
              href: href(f, docId),
              label: t(`studio.docs.filter.${f}`),
              active: filter === f,
            }))}
          />
          {shown.length === 0 ? (
            <EmptyState compact icon={<FileTextIcon />} title={docs.length ? t("studio.docs.noMatch") : t("studio.docs.emptyTitle")} body={docs.length ? undefined : t("studio.docs.emptyBody")} />
          ) : (
            <ul className="-mx-2 max-h-[calc(100dvh-280px)] overflow-y-auto">
              {shown.map((d) => {
                const s = statusTone("deliverable", d.status);
                return (
                  <li key={d.id}>
                    <Link
                      href={href(filter, d.id)}
                      aria-current={d.id === docId ? "page" : undefined}
                      className={cn("block rounded-md px-2 py-1.5 transition-colors duration-100 hover:bg-hover", d.id === docId && "bg-accent")}
                    >
                      <span className="flex items-center gap-2">
                        <FileTextIcon className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-foreground">{d.title}</span>
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 pl-6 text-xs text-tertiary">
                        <Badge tone={s.tone}>{t(s.label)}</Badge>
                        <span className="truncate">
                          {kindLabel(d.kind)} · {d.teammateId ? (names.get(d.teammateId) ?? t("studio.docs.team")) : t("studio.docs.you")}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
        <div className="min-w-0">
          {doc && (
            <Button asChild size="sm" variant="ghost" className={cn("mb-3 -ml-2 text-muted-foreground", !focus && "@3xl:hidden")}>
              <Link href={href(filter)}>
                <ChevronLeft /> {t("studio.docs.allDocs")}
              </Link>
            </Button>
          )}
          <Editor
            key={doc?.id ?? "new"}
            businessId={businessId}
            doc={doc}
            author={doc?.teammateId ? names.get(doc.teammateId) : undefined}
            media={media}
            onHandOver={setHand}
            canHand={teammates.some((m) => m.kind === "ai")}
          />
        </div>
      </div>
    </WorkspaceShell>
  );
}

function Editor({
  businessId,
  doc,
  author,
  media,
  onHandOver,
  canHand,
}: {
  businessId: string;
  doc?: Deliverable;
  author?: string;
  media: MediaOption[];
  onHandOver: (h: { key: string; text: string; attachments: string[] }) => void;
  canHand: boolean;
}) {
  const t = useT();
  const tn = useTn();
  const kindLabel = useKindLabel();
  const router = useRouter();
  const [title, setTitle] = useState(doc?.title ?? "");
  const [kind, setKind] = useState(doc?.kind ?? "brief");
  const [channel, setChannel] = useState(doc?.channel ?? "");
  const [content, setContent] = useState(doc?.content ?? "");
  const [status, setStatus] = useState<DeliverableStatus>(doc?.status ?? "draft");
  const [attachments, setAttachments] = useState<string[]>(doc?.attachments ?? []);
  const [tab, setTab] = useState<"write" | "split" | "preview">("write");
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();
  const kinds = KINDS.includes(kind) ? KINDS : [kind, ...KINDS];
  const dirty =
    title !== (doc?.title ?? "") ||
    kind !== (doc?.kind ?? "brief") ||
    channel !== (doc?.channel ?? "") ||
    content !== (doc?.content ?? "") ||
    status !== (doc?.status ?? "draft") ||
    attachments.join() !== (doc?.attachments ?? []).join();

  const save = () =>
    start(async () => {
      const r = await saveDoc(businessId, { id: doc?.id, title, kind, channel, content, status, attachments });
      if ("error" in r) return setMsg({ error: localizeError(t, r.error) });
      setMsg({ ok: t("common.saved") });
      if (!doc) router.replace(`/b/${businessId}/docs?doc=${r.id}`);
    });

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  // Instructions for the teammate (agent-facing, like the rest of the task text), not UI chrome.
  const handOver = `Work from this ${label(kind).toLowerCase()} (saved as "${title}"):\n\n${content}`.slice(0, 20000);

  return (
    <div className={cn("mx-auto w-full", tab === "split" ? "max-w-none" : "max-w-[var(--doc-w)]")}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("studio.docs.titlePlaceholder")}
        aria-label={t("studio.docs.title")}
        className="w-full border-0 bg-transparent p-0 text-2xl leading-8 font-semibold text-foreground outline-none placeholder:text-placeholder focus-visible:outline-none"
      />
      <div className="mt-4 space-y-0.5">
        <PropRow label={t("studio.docs.kind")}>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger size="sm" className="border-transparent hover:border-input" aria-label={t("studio.docs.kind")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {kindLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropRow>
        <PropRow label={t("studio.docs.status")}>
          <Select value={status} onValueChange={(v) => setStatus(v as DeliverableStatus)}>
            <SelectTrigger size="sm" className="border-transparent hover:border-input" aria-label={t("studio.docs.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS.map((s) => {
                const st = statusTone("deliverable", s);
                return (
                  <SelectItem key={s} value={s}>
                    <Badge tone={st.tone}>{t(st.label)}</Badge>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </PropRow>
        <PropRow label={t("studio.docs.channel")}>
          <Input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder={t("studio.docs.channelPlaceholder")}
            aria-label={t("studio.docs.channel")}
            className="h-7 border-transparent text-[13px] shadow-none hover:border-input"
          />
        </PropRow>
        {author && (
          <PropRow label={t("studio.docs.author")}>
            <span className="px-2.5 text-foreground">{author}</span>
          </PropRow>
        )}
      </div>

      <div className="mt-6 flex items-center gap-2 border-b border-border pb-2">
        <Segmented
          label={t("studio.docs.mode")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "write", label: t("studio.docs.write") },
            { value: "split", label: t("studio.docs.split") },
            { value: "preview", label: t("studio.docs.preview") },
          ]}
        />
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" aria-expanded={picking} onClick={() => setPicking(!picking)}>
          <Paperclip /> {picking ? t("studio.docs.doneAttaching") : t("studio.docs.attach")}
        </Button>
      </div>

      {picking && (
        <div className="mt-3 grid max-h-56 grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 overflow-y-auto rounded-lg border border-border p-2">
          {media.length === 0 && <p className="col-span-full p-2 text-xs text-tertiary">{t("studio.docs.libraryEmpty")}</p>}
          {media.map((m) => {
            const on = attachments.includes(m.path);
            return (
              <button
                key={m.path}
                type="button"
                title={m.name}
                aria-pressed={on}
                onClick={() => setAttachments((a) => (a.includes(m.path) ? a.filter((x) => x !== m.path) : [...a, m.path]))}
                className={cn("rounded-md", on && "ring-2 ring-ring ring-offset-2 ring-offset-background")}
              >
                <Thumb businessId={businessId} path={m.path} kind={m.kind} />
              </button>
            );
          })}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {attachments.map((p) => (
            <span key={p} className="group/att relative">
              <Thumb businessId={businessId} path={p} />
              <button
                type="button"
                onClick={() => setAttachments((a) => a.filter((x) => x !== p))}
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-xs transition-opacity duration-100 group-hover/att:opacity-100 hover:text-foreground focus-visible:opacity-100"
                aria-label={t("studio.docs.removeAttachment")}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={cn("mt-3", tab === "split" && "grid gap-6 @5xl:grid-cols-2")}>
        {tab !== "preview" && (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            aria-label={t("studio.docs.body")}
            placeholder={t("studio.docs.bodyPlaceholder")}
            // Grows with the text: the page scrolls, not a box inside it.
            className={cn(
              "min-h-[60vh] resize-none border-0 px-0 text-[15px] leading-[26px] shadow-none [field-sizing:content] hover:border-0 focus-visible:ring-0",
              tab === "split" && "font-mono text-[13px] leading-[22px]",
            )}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                save();
              }
            }}
          />
        )}
        {tab !== "write" && (
          <div className={cn("min-h-[60vh] min-w-0", tab === "split" && "border-t border-border pt-6 @5xl:border-t-0 @5xl:border-l @5xl:pt-0 @5xl:pl-6")}>
            {content.trim() ? <Markdown className="text-[15px] leading-[26px]">{content}</Markdown> : <p className="text-sm text-tertiary">{t("studio.docs.nothingToPreview")}</p>}
          </div>
        )}
      </div>

      <div className="sticky bottom-[calc(var(--bottombar-h)+env(safe-area-inset-bottom))] mt-4 flex flex-wrap items-center gap-2 border-t border-border bg-background py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" onClick={save} loading={pending} disabled={pending || !dirty || !title.trim()}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("common.save")} <Kbd>⌘S</Kbd>
          </TooltipContent>
        </Tooltip>
        <span className="text-xs text-tertiary tabular-nums">{tn("studio.docs.words", words)}</span>
        {msg?.ok && !dirty && <span className="text-xs text-tertiary">{msg.ok}</span>}
        {msg?.error && (
          <span role="alert" className="text-xs text-destructive">
            {msg.error}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {doc && content.trim() && canHand && (
            <Button size="sm" variant="secondary" onClick={() => onHandOver({ key: `${doc.id}:${doc.title}:${doc.content.length}`, text: handOver, attachments })}>
              <UserRoundPlus /> {t("studio.docs.hand")}
            </Button>
          )}
          <IconButton label={t("studio.docs.prepareHelp")} side="top">
            <Info />
          </IconButton>
          {doc && (
            <MoreMenu label={t("studio.more")} disabled={pending}>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 /> {t("common.delete")}
              </DropdownMenuItem>
            </MoreMenu>
          )}
        </span>
      </div>
      {doc && (
        <DeleteDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={t("studio.docs.deleteTitle", { title: doc.title })}
          body={t("studio.docs.deleteBody")}
          onConfirm={() => {
            setDeleting(false);
            start(async () => {
              await deleteDoc(businessId, doc.id);
              toast(t("studio.docs.deleted"));
              router.replace(`/b/${businessId}/docs`);
            });
          }}
        />
      )}
    </div>
  );
}

function Thumb({ businessId, path, kind }: { businessId: string; path: string; kind?: MediaKind }) {
  const k = kind ?? (/\.(png|jpe?g|webp|gif|svg)$/i.test(path) ? "image" : /\.(mp4|mov|m4v|webm)$/i.test(path) ? "video" : "file");
  return (
    <span className="flex size-16 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-black/5 ring-inset">
      {k === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
        <img src={fileUrl(businessId, path)} alt="" className="size-full object-cover" />
      ) : k === "video" ? (
        <VideoIcon className="size-6 text-placeholder" strokeWidth={1.5} />
      ) : (
        <ImageIcon className="size-6 text-placeholder" strokeWidth={1.5} />
      )}
    </span>
  );
}
