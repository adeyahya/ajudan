"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ComponentProps } from "react";
import { defaultRehypePlugins } from "streamdown";
import { toast } from "sonner";
import { Download, ImageIcon, Info, Link2, Paperclip, Printer, Trash2, UserRoundPlus, VideoIcon, XIcon } from "lucide-react";
import { useLang, useT, useTn } from "@/components/i18n";
import { fileUrl } from "@/components/image-strip";
import { Badge, Button, cn, IconButton, Input, Kbd } from "@/components/kit";
import { Markdown } from "@/components/markdown";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DeleteDialog, localizeError, MoreMenu, PropRow, Segmented } from "@/components/workspace-ui";
import type { Deliverable, DeliverableStatus } from "@/db/schema";
import { normalizeFolder } from "@/lib/docs-folders";
import { DOC_STATUSES } from "@/lib/docs-list";
import { resolveMentions } from "@/lib/docs-mentions";
import { docTemplate, templateText } from "@/lib/docs-templates";
import type { MessageKey } from "@/lib/i18n";
import type { MediaKind } from "@/lib/media-types";
import { statusTone } from "@/lib/status-tones";
import { deleteDoc, saveDoc } from "./actions";
import { MentionTextarea, type MentionOption } from "./mention-textarea";

/** Kinds with a label in studio.docs.kind.* … */
const STUDIO_KINDS = ["note", "brief", "plan", "script", "social_post", "blog_post", "email", "ad_copy", "report", "faq", "price_list"];
/** … and the template kinds, labelled in docs.kind.*. */
const DOC_KINDS = ["quote", "sop", "meeting_notes", "product_sheet"];
export const KINDS = [...STUDIO_KINDS, ...DOC_KINDS];
/** The English label of a kind nobody translated (kinds the team invented): "case_study" → "Case study". */
export const kindFallback = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function useKindLabel() {
  const t = useT();
  return (k: string) =>
    STUDIO_KINDS.includes(k) ? t(`studio.docs.kind.${k}` as MessageKey) : DOC_KINDS.includes(k) ? t(`docs.kind.${k}` as MessageKey) : kindFallback(k);
}

export type MediaOption = { path: string; name: string; kind: MediaKind };
export type HandOver = { key: string; text: string; attachments: string[] };

/** The preview: markdown with @mentions drawn as chips that open the mentioned object. */
const PREVIEW_REHYPE = [defaultRehypePlugins.raw, defaultRehypePlugins.sanitize];
function DocPreview({ businessId, content }: { businessId: string; content: string }) {
  const { text, hrefs } = useMemo(() => resolveMentions(content, businessId), [content, businessId]);
  const components = useMemo(
    () =>
      ({
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
          href && hrefs.has(href) ? (
            <Link
              href={href}
              className="inline-flex items-center rounded-sm bg-secondary px-1 font-medium text-foreground! no-underline! hover:bg-hover-strong"
            >
              @{children}
            </Link>
          ) : (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
      }) as unknown as NonNullable<ComponentProps<typeof Markdown>["components"]>,
    [hrefs],
  );
  return (
    <Markdown className="text-[15px] leading-[26px]" components={components} rehypePlugins={PREVIEW_REHYPE}>
      {text}
    </Markdown>
  );
}

/**
 * One deliverable: title, properties (kind, status, folder, channel), the markdown body with
 * @mentions, attachments, and save / hand over / links / export / delete.
 */
export function Editor({
  businessId,
  doc,
  template,
  initialFolder,
  folders,
  author,
  media,
  mentions,
  backHref,
  onHandOver,
  onShowLinks,
  canHand,
}: {
  businessId: string;
  doc?: Deliverable;
  /** For a new doc: a template key from src/lib/docs-templates.ts. */
  template?: string;
  initialFolder?: string | null;
  folders: string[];
  author?: string;
  media: MediaOption[];
  mentions: MentionOption[];
  backHref: string;
  onHandOver: (h: HandOver) => void;
  onShowLinks: () => void;
  canHand: boolean;
}) {
  const t = useT();
  const tn = useTn();
  const lang = useLang();
  const kindLabel = useKindLabel();
  const router = useRouter();
  const start0 = useMemo(() => {
    if (doc) return { title: doc.title, kind: doc.kind, content: doc.content, folder: doc.folder ?? "" };
    const tpl = docTemplate(template);
    if (!tpl) return { title: "", kind: "brief", content: "", folder: initialFolder ?? "" };
    const text = templateText(tpl, lang);
    return { title: text.title, kind: tpl.kind, content: text.body, folder: initialFolder ?? "" };
  }, [doc, template, initialFolder, lang]);
  const [title, setTitle] = useState(start0.title);
  const [kind, setKind] = useState(start0.kind);
  const [channel, setChannel] = useState(doc?.channel ?? "");
  const [content, setContent] = useState(start0.content);
  const [folder, setFolder] = useState(start0.folder);
  const [status, setStatus] = useState<DeliverableStatus>(doc?.status ?? "draft");
  const [attachments, setAttachments] = useState<string[]>(doc?.attachments ?? []);
  const [tab, setTab] = useState<"write" | "split" | "preview">("write");
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();
  const kinds = KINDS.includes(kind) ? KINDS : [kind, ...KINDS];
  const dirty =
    !doc ||
    title !== doc.title ||
    kind !== doc.kind ||
    channel !== (doc.channel ?? "") ||
    content !== doc.content ||
    status !== doc.status ||
    normalizeFolder(folder) !== doc.folder ||
    attachments.join() !== doc.attachments.join();

  const save = () =>
    start(async () => {
      const r = await saveDoc(businessId, { id: doc?.id, title, kind, channel, content, status, attachments, folder: normalizeFolder(folder) });
      if ("error" in r) return setMsg({ error: localizeError(t, r.error) });
      setMsg({ ok: t("common.saved") });
      if (!doc) router.replace(`/b/${businessId}/docs?doc=${r.id}`);
    });

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  // Instructions for the teammate (agent-facing, like the rest of the task text), not UI chrome.
  const handOver = `Work from this ${kindFallback(kind).toLowerCase()} (saved as "${title}"):\n\n${content}`.slice(0, 20000);
  const exportHref = (format: string) => (doc ? `/api/b/${businessId}/docs/${doc.id}/export?format=${format}` : "#");

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
              {DOC_STATUSES.map((s) => {
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
        <PropRow label={t("docs.folder")}>
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            list="doc-folders"
            placeholder={t("docs.folderPlaceholder")}
            aria-label={t("docs.folder")}
            className="h-7 border-transparent text-[13px] shadow-none hover:border-input"
          />
          <datalist id="doc-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
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
        <span className="hidden truncate text-xs text-tertiary @2xl:inline">{t("docs.mentionHint")}</span>
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
          <MentionTextarea
            value={content}
            onChange={setContent}
            options={mentions}
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
                if (dirty && title.trim()) save();
              }
            }}
          />
        )}
        {tab !== "write" && (
          <div className={cn("min-h-[60vh] min-w-0", tab === "split" && "border-t border-border pt-6 @5xl:border-t-0 @5xl:border-l @5xl:pt-0 @5xl:pl-6")}>
            {content.trim() ? <DocPreview businessId={businessId} content={content} /> : <p className="text-sm text-tertiary">{t("studio.docs.nothingToPreview")}</p>}
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
              <DropdownMenuItem onSelect={onShowLinks}>
                <Link2 /> {t("docs.links")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-tertiary">{t("docs.export")}</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <a href={exportHref("md")} download>
                  <Download /> {t("docs.exportMd")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportHref("html")} download>
                  <Download /> {t("docs.exportHtml")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportHref("print")} target="_blank" rel="noreferrer">
                  <Printer /> {t("docs.print")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
              router.replace(backHref);
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
