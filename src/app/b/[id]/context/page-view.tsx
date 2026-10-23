"use client";

import { BookmarkPlus, ChartColumn, Clock, Ellipsis, Folder, FolderInput, ImagePlus, Link2, Smile, Table2, Trash2, User, Users } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { TopBarActions, useBreadcrumb } from "@/components/breadcrumb";
import { DocLayoutButtons } from "@/components/doc-layout";
import { useLang, useT, useTn } from "@/components/i18n";
import { Avatar, Button, cn, CountPill, EditorSkeleton, IconButton, PageBody } from "@/components/kit";
import { SidePeek, SidePeekLayout, useUrlPeek } from "@/components/side-peek";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContextSection } from "@/db/schema";
import { SECTIONS } from "@/lib/context-text";
import { dateLocale } from "@/lib/i18n";
import { deletePageAction, markCheckedAction, movePageAction, renamePageAction, savePageAction, setCoverAction, setIconAction } from "./actions";
import { PagePeekBody, Readers, Suggestions, type PeekTab } from "./context-peek";
import { TeamPanel } from "./team-panel";
import type { EditorData } from "./editor";
import { IconPicker, PageIcon } from "./page-icon";
import type { CoverImage, CurrentPage, HistoryItem, Mate, ReaderView, SizeView, SuggestionView, UsageView } from "./types";

// ProseMirror needs the browser: the editor only renders on the client.
const PageEditor = dynamic(() => import("./editor"), { ssr: false, loading: () => <EditorSkeleton className="mt-2 [&>*:first-child]:hidden" /> });
// The mind map measures text with a canvas: client only too.
const MindMap = dynamic(() => import("./mind-map"), { ssr: false, loading: () => <div className="h-[62vh] min-h-[420px] animate-pulse rounded-lg bg-muted" /> });

const PEEK_TABS: PeekTab[] = ["suggestions", "team", "usage"];

/**
 * One Konteks page, like a Notion page: optional cover (full width), icon, a 40px title,
 * a row of chips (section, who reads it, last checked, reads this week, owner), this
 * page's pending suggestions inline, then the editor in the doc column (860px, or full
 * width / focus mode from the top bar: src/components/doc-layout.tsx). On wide screens
 * "How the team uses this page" (team-panel.tsx) sits beside it; the top bar carries the
 * save state, "Suggestions (n)" and a "…" menu, and the side peek (?peek=…) has every
 * suggestion, the team panel and usage.
 */
export function PageView(p: {
  businessId: string;
  page: CurrentPage;
  ancestors: { id: string; title: string }[];
  mates: Mate[];
  readers: ReaderView[];
  suggestions: SuggestionView[];
  otherPending: { pageId: string; title: string; count: number }[];
  usage: UsageView;
  size: SizeView;
  history: HistoryItem[];
  contactsCount: number;
  covers: CoverImage[];
  editor: Omit<EditorData, "openPage" | "openContact">;
}) {
  const { businessId, page } = p;
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const base = `/b/${businessId}/context`;
  const peek = useUrlPeek("peek");
  // "readers" from older links is the Team tab now.
  const tab = peek.value === "readers" ? "team" : PEEK_TABS.includes(peek.value as PeekTab) ? (peek.value as PeekTab) : "suggestions";
  const tn = useTn();
  // This page's own suggestions show on the page; new-page ones stay in the peek.
  const inline = p.suggestions.filter((s) => s.pageId === page.id);
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [, start] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [icon, setIcon] = useOptimistic(page.icon);
  const [cover, setCover] = useOptimistic(page.cover);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<{ body: string; blocks?: unknown[] } | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useBreadcrumb([...p.ancestors.map((a) => ({ label: a.title, href: `${base}?page=${a.id}` })), { label: title.trim() || t("context.untitled") }]);

  const flush = async () => {
    clearTimeout(timer.current);
    const v = latest.current;
    if (!v) return;
    latest.current = null;
    setStatus("saving");
    try {
      const r = await savePageAction(businessId, page.id, v);
      setStatus("ok" in r ? "saved" : "failed");
    } catch {
      latest.current = latest.current ?? v;
      setStatus("failed");
    }
  };
  // Leaving the page (or the tab) saves what's left.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush reads refs only
  }, []);
  // A fresh page starts with its title selected, like Notion.
  useEffect(() => {
    if (page.title === t("context.untitled") && !page.body.trim()) titleRef.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only
  }, []);

  const saveTitle = () => {
    const clean = title.trim();
    if (!clean) return setTitle(page.title);
    if (clean !== page.title) start(() => renamePageAction(businessId, page.id, clean));
  };
  const pickIcon = (v: string | null) =>
    start(async () => {
      setIcon(v || null);
      await setIconAction(businessId, page.id, v);
    });
  const pickCover = (v: string | null) =>
    start(async () => {
      setCover(v);
      await setCoverAction(businessId, page.id, v);
    });
  const copyLink = () => void navigator.clipboard?.writeText(`${location.origin}${base}?page=${page.id}`).then(() => toast(t("context.tree.linkCopied")));

  const editorData: EditorData = {
    ...p.editor,
    openPage: (id) => router.push(`${base}?page=${id}`),
    openContact: (id) => router.push(`${base}/people?c=${id}`),
  };

  const always = p.mates.filter((m) => p.readers.find((r) => r.teammateId === m.id)?.mode === "always");
  const needed = p.mates.filter((m) => p.readers.find((r) => r.teammateId === m.id)?.mode === "when_needed");
  const owner = page.owner.kind === "owner" ? t("context.by.owner") : page.owner.kind === "system" ? t("context.by.system") : t("context.by.teammate", { name: page.owner.name ?? "" });
  const checked = page.lastCheckedAt ? new Date(page.lastCheckedAt).toLocaleDateString(dateLocale(lang), { dateStyle: "medium" }) : t("context.never");

  const chip = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs leading-4 font-medium transition-colors duration-100";
  const neutral = cn(chip, "bg-secondary text-secondary-foreground hover:bg-hover-strong");
  const chips = (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {page.parentId ? (
        <span className={cn(chip, "bg-secondary text-muted-foreground")}>
          <Folder className="size-3.5" aria-hidden />
          {t(`context.section.${page.section}`)}
        </span>
      ) : (
        <Select value={page.section} onValueChange={(v) => start(async () => void (await movePageAction(businessId, page.id, { parentId: null, section: v as ContextSection })))}>
          <SelectTrigger size="sm" className={cn(neutral, "border-0 shadow-none [&>svg]:size-3")} aria-label={t("context.prop.section")}>
            <Folder className="size-3.5" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`context.section.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn(chip, "bg-info-soft text-tag-blue-fg hover:opacity-85")}>
            {always.length > 0 && (
              <span className="flex -space-x-1">
                {always.slice(0, 4).map((m) => (
                  <Avatar key={m.id} seed={m.id} name={m.name} color={m.color} size={16} className="ring-1 ring-info-soft" />
                ))}
              </span>
            )}
            <span className="truncate">{t("context.readBySummary", { always: always.length, needed: needed.length })}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[400px] max-w-[92vw]">
          <p className="mb-2 text-[13px] leading-[18px] font-semibold">{t("context.panel.readers")}</p>
          <Readers businessId={businessId} pageId={page.id} mates={p.mates} readers={p.readers} isPage={page.kind !== "database"} />
        </PopoverContent>
      </Popover>
      {page.kind !== "database" && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={cn(chip, page.stale ? "bg-warning-soft text-tag-yellow-fg hover:opacity-85" : "bg-secondary text-secondary-foreground hover:bg-hover-strong")}>
              <Clock className="size-3.5" aria-hidden />
              {page.lastCheckedAt ? t("context.chip.checked", { date: checked }) : t("context.chip.neverChecked")}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <p className="text-[13px] leading-[18px] text-muted-foreground">{t(page.stale ? "context.chip.staleHelp" : "context.chip.checkHelp")}</p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() =>
                start(async () => {
                  await markCheckedAction(businessId, page.id);
                  toast(t("context.checkedToast"));
                })
              }
            >
              {t("context.markChecked")}
            </Button>
          </PopoverContent>
        </Popover>
      )}
      <button type="button" onClick={() => peek.open("usage")} className={neutral}>
        <ChartColumn className="size-3.5" aria-hidden />
        {tn("context.chip.reads", p.usage.runs)}
      </button>
      <span className={cn(chip, "text-muted-foreground")}>
        <User className="size-3.5" aria-hidden />
        {owner}
      </span>
    </div>
  );

  const peekPane = (
    <SidePeek open={!!peek.value} onClose={peek.close} title={t("context.peek.title")} description={page.title}>
      <PagePeekBody
        tab={tab}
        onTab={(x) => peek.open(x)}
        businessId={businessId}
        pageId={page.id}
        isPage={page.kind !== "database"}
        suggestions={p.suggestions}
        otherPending={p.otherPending}
        mates={p.mates}
        readers={p.readers}
        usage={p.usage}
        size={p.size}
        history={p.history}
      />
    </SidePeek>
  );

  return (
    <SidePeekLayout peek={peekPane}>
      <TopBarActions>
        <span aria-live="polite" className={cn("hidden px-1 text-xs whitespace-nowrap sm:inline", status === "failed" ? "text-destructive" : "text-tertiary")} title={status === "failed" ? t("context.saveFailed") : undefined}>
          {status === "saving" ? t("context.saving") : status === "saved" ? t("context.saved") : status === "failed" ? t("context.saveFailedShort") : ""}
        </span>
        <DocLayoutButtons />
        <Button size="sm" variant="ghost" onClick={() => (peek.value ? peek.close() : peek.open("suggestions"))} aria-pressed={!!peek.value}>
          <BookmarkPlus />
          <span className="hidden sm:inline">{t("context.peek.tabSuggestions")}</span>
          {p.suggestions.length > 0 && <CountPill count={p.suggestions.length} className="bg-primary text-primary-foreground" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t("context.tree.more")}>
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => peek.open("team")}>
              <Users />
              {t("context.peek.tabTeam")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => peek.open("usage")}>
              <ChartColumn />
              {t("context.peek.tabUsage")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={copyLink}>
              <Link2 />
              {t("context.tree.copyLink")}
            </DropdownMenuItem>
            {!page.parentId && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput />
                  {t("context.tree.moveTo")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {SECTIONS.filter((s) => s !== page.section).map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => start(async () => void (await movePageAction(businessId, page.id, { parentId: null, section: s })))}>
                      {t(`context.section.${s}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!!page.key} onSelect={() => setDeleting(true)}>
              <Trash2 />
              {page.key ? t("context.tree.kept") : t("context.deletePage")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TopBarActions>

      {cover && <Cover businessId={businessId} cover={cover} covers={p.covers} onPick={pickCover} />}

      <div className="flex">
      <div className="min-w-0 flex-1">
      <PageBody width="doc" className={cn(cover ? "pt-0 sm:pt-0" : "sm:pt-16")}>
        <div className="group/head">
          {icon ? (
            <IconPicker open={iconOpen} onOpenChange={setIconOpen} onPick={pickIcon}>
              <button
                type="button"
                aria-label={t("context.tree.changeIcon")}
                className={cn("relative flex size-[78px] items-center justify-center rounded-lg text-foreground transition-colors duration-100 hover:bg-hover", cover ? "-mt-[42px] mb-1" : "mb-1")}
              >
                <PageIcon icon={icon} kind={page.kind} size={64} />
              </button>
            </IconPicker>
          ) : null}
          <div className={cn("flex h-7 items-center gap-1 opacity-0 transition-opacity duration-150 group-focus-within/head:opacity-100 group-hover/head:opacity-100 [@media(hover:none)]:opacity-100", cover && !icon && "mt-3")}>
            {!icon && (
              <IconPicker open={iconOpen} onOpenChange={setIconOpen} onPick={pickIcon}>
                <Button size="sm" variant="ghost" className="-ml-2 text-tertiary hover:text-muted-foreground">
                  <Smile />
                  {t("context.addIcon")}
                </Button>
              </IconPicker>
            )}
            {!cover && (
              <CoverPicker covers={p.covers} businessId={businessId} onPick={pickCover}>
                <Button size="sm" variant="ghost" className={cn("text-tertiary hover:text-muted-foreground", icon && "-ml-2")}>
                  <ImagePlus />
                  {t("context.addCover")}
                </Button>
              </CoverPicker>
            )}
          </div>
          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveTitle();
                document.querySelector<HTMLElement>(".ajudan-page-editor [contenteditable=true], .ajudan-mind-map [role=tree]")?.focus();
              }
              if (e.key === "Escape") {
                setTitle(page.title);
                e.currentTarget.blur();
              }
            }}
            placeholder={t("context.untitled")}
            aria-label={t("context.titleLabel")}
            className="mt-1 block w-full resize-none overflow-hidden bg-transparent text-[32px] leading-[40px] font-bold tracking-[-0.02em] text-foreground outline-none [field-sizing:content] placeholder:text-placeholder sm:text-[40px] sm:leading-[48px]"
          />
        </div>

        {chips}

        {inline.length > 0 && (
          <section aria-label={t("context.peek.tabSuggestions")} className="mt-6 rounded-lg border border-primary/25 bg-primary-soft p-4">
            <p className="mb-3 text-[13px] leading-[18px] font-semibold">{tn("context.inline.title", inline.length)}</p>
            <Suggestions businessId={businessId} suggestions={inline} mates={p.mates} otherPending={[]} />
          </section>
        )}

        <div className="mt-4 border-t border-border pt-4">
          {page.kind === "database" ? (
            <DatabaseBlock businessId={businessId} count={p.contactsCount} />
          ) : page.kind === "mindmap" ? (
            <MindMap
              title={title.trim()}
              markdown={page.body}
              onEditTitle={() => titleRef.current?.focus()}
              onSave={(body) => {
                latest.current = { body };
                setStatus("saving");
                clearTimeout(timer.current);
                timer.current = setTimeout(() => void flush(), 800);
              }}
            />
          ) : (
            <div className="min-h-[50vh]">
              <PageEditor
                data={editorData}
                blocks={page.blocks}
                markdown={page.body}
                externalStamp={page.externalStamp}
                onSave={(v) => {
                  latest.current = v;
                  setStatus("saving");
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => void flush(), 800);
                }}
              />
            </div>
          )}
        </div>
      </PageBody>
      </div>
      {tab !== "team" || !peek.value ? (
        <aside data-focus-hide aria-label={t("context.team.title")} className="hidden w-[360px] shrink-0 border-l border-border px-5 pt-16 pb-10 2xl:block">
          <div className="sticky top-[calc(var(--topbar-h)+24px)]">
            <h2 className="mb-5 text-sm font-semibold">{t("context.team.title")}</h2>
            <TeamPanel businessId={businessId} pageId={page.id} mates={p.mates} readers={p.readers} isPage={page.kind !== "database"} size={p.size} history={p.history} />
          </div>
        </aside>
      ) : null}
      </div>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("context.deleteConfirm", { title: page.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t("context.tree.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                start(async () => {
                  await deletePageAction(businessId, page.id);
                  toast(t("context.tree.deleted", { title: page.title }));
                  router.push(base);
                })
              }
            >
              {t("context.deletePage")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidePeekLayout>
  );
}

const fileUrl = (businessId: string, path: string) => `/api/b/${businessId}/files/${path.split("/").map(encodeURIComponent).join("/")}`;

/** The cover: full width over the page, 200px (240 on desktop); hover shows Change / Remove. */
function Cover({ businessId, cover, covers, onPick }: { businessId: string; cover: string; covers: CoverImage[]; onPick: (v: string | null) => void }) {
  const t = useT();
  return (
    <div className="group/cover relative h-[180px] w-full bg-muted sm:h-[240px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- a file from the business folder */}
      <img src={fileUrl(businessId, cover)} alt="" className="size-full object-cover" />
      <div className="absolute right-4 bottom-3 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within/cover:opacity-100 group-hover/cover:opacity-100 sm:right-12 [@media(hover:none)]:opacity-100">
        <CoverPicker covers={covers} businessId={businessId} onPick={onPick}>
          <Button size="sm" variant="secondary" className="h-7 bg-background/90 text-xs backdrop-blur">
            {t("context.changeCover")}
          </Button>
        </CoverPicker>
        <Button size="sm" variant="secondary" className="h-7 bg-background/90 text-xs backdrop-blur" onClick={() => onPick(null)}>
          {t("common.remove")}
        </Button>
      </div>
    </div>
  );
}

/** Library images in a 4-column grid. */
function CoverPicker({ covers, businessId, onPick, children }: { covers: CoverImage[]; businessId: string; onPick: (v: string) => void; children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] max-w-[92vw] gap-0 p-0">
        <p className="flex h-10 items-center border-b border-border px-3 text-[13px] font-medium">{t("context.coverFromLibrary")}</p>
        {covers.length ? (
          <div className="grid max-h-[300px] grid-cols-4 gap-2 overflow-y-auto p-3">
            {covers.map((c) => (
              <button
                key={c.path}
                type="button"
                title={c.title || c.path}
                onClick={() => (onPick(c.path), setOpen(false))}
                className="aspect-[4/3] overflow-hidden rounded-md bg-muted ring-1 ring-black/5 transition-opacity duration-100 ring-inset hover:opacity-85"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a file from the business folder */}
                <img src={fileUrl(businessId, c.path)} alt={c.title || c.path} loading="lazy" className="size-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <p className="text-[13px] text-muted-foreground">{t("context.noCovers")}</p>
            <Button asChild size="sm" variant="secondary" className="mt-3">
              <Link href={`/b/${businessId}/studio`}>{t("context.openLibrary")}</Link>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The address book page: a database, opened as the People table. */
function DatabaseBlock({ businessId, count }: { businessId: string; count: number }) {
  const t = useT();
  const tn = useTn();
  return (
    <Link
      href={`/b/${businessId}/context/people`}
      className="group flex items-center gap-3 rounded-lg border border-border p-3 transition-colors duration-100 hover:bg-hover"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Table2 className="size-5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5 font-medium">{t("context.dbOpen")}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {tn("context.dbCount", count)} · {t("context.dbIntro")}
        </span>
      </span>
    </Link>
  );
}
