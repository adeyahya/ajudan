"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { BookOpen, ChevronLeft, FileTextIcon, FolderIcon, FolderInput, FolderPlus, LayoutGrid, Pencil, PlusIcon, Tag, Trash2, XIcon } from "lucide-react";
import { DocLayoutButtons, useDocLayout } from "@/components/doc-layout";
import { TopBarActions } from "@/components/breadcrumb";
import { useT, useTn } from "@/components/i18n";
import { Badge, Button, cn, EmptyState, Input } from "@/components/kit";
import { ObjectPanel } from "@/components/object-panel";
import { PlanTask } from "@/components/plan-task";
import { SidePeek } from "@/components/side-peek";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DeleteDialog, MoreMenu, WorkspaceShell } from "@/components/workspace-ui";
import type { Deliverable, DeliverableStatus } from "@/db/schema";
import { folderParent, folderTree, isInFolder, normalizeFolder } from "@/lib/docs-folders";
import { DOC_STATUSES, docsHref, filterDocs, STATUS_FILTERS, teammateOf, type DocItem, type DocsFilter, type DocStatus } from "@/lib/docs-list";
import { mentionHref } from "@/lib/docs-mentions";
import { DOC_TEMPLATES } from "@/lib/docs-templates";
import type { MessageKey } from "@/lib/i18n";
import { statusTone } from "@/lib/status-tones";
import { moveDocsToFolder, renameDocFolder, setStatusOfDocs, trashManyDocs } from "./actions";
import { Editor, useKindLabel, type HandOver, type MediaOption } from "./editor";
import type { MentionOption } from "./mention-textarea";

type Mate = { id: string; name: string; title: string; kind: string };
const ANY = "any";

/**
 * Docs: one list over saved work (deliverables) and Context pages, with folders, filters,
 * search and bulk actions; a deliverable opens in the editor, a Context page in Context.
 */
export function Docs({
  businessId,
  items,
  matches,
  filter,
  doc,
  newTemplate,
  teammates,
  media,
  candidates,
}: {
  businessId: string;
  items: DocItem[];
  /** "deliverable:<id>" / "context:<id>" keys matching ?q, or null without a search. */
  matches: string[] | null;
  filter: DocsFilter;
  /** The open doc, in full. */
  doc?: Deliverable;
  /** Set when writing a new doc: "blank" or a template key. */
  newTemplate?: string;
  teammates: Mate[];
  media: MediaOption[];
  candidates: MentionOption[];
}) {
  const t = useT();
  const [peek, setPeek] = useState<{ kind: "hand"; hand: HandOver } | { kind: "links" } | null>(null);
  const { focus } = useDocLayout();
  const names = useMemo(() => new Map(teammates.map((m) => [m.id, m.name])), [teammates]);
  const folders = useMemo(() => folderTree(items.map((d) => d.folder)).map((f) => f.path), [items]);
  const editing = !!doc || newTemplate !== undefined;
  const listHref = docsHref(businessId, filter);

  const peekEl = (
    <SidePeek
      open={!!peek}
      onClose={() => setPeek(null)}
      title={peek?.kind === "links" ? t("docs.links") : t("studio.docs.handTitle")}
      description={peek?.kind === "links" ? t("docs.linksHelp") : t("studio.docs.handHelp")}
    >
      {peek?.kind === "hand" && (
        <div className="space-y-4">
          <PlanTask
            key={peek.hand.key}
            businessId={businessId}
            teammates={teammates.filter((m) => m.kind === "ai")}
            attachments={peek.hand.attachments}
            defaultText={peek.hand.text}
            onDone={() => setPeek(null)}
          />
        </div>
      )}
      {peek?.kind === "links" && doc && <ObjectPanel businessId={businessId} objectRef={{ type: "deliverable", id: doc.id }} />}
    </SidePeek>
  );

  if (editing) {
    const author = doc ? teammateOf(doc.createdBy ?? (doc.teammateId ? `teammate:${doc.teammateId}` : "owner")) : null;
    return (
      <WorkspaceShell title={t("nav.docs")} peek={peekEl}>
        <TopBarActions>
          <DocLayoutButtons />
        </TopBarActions>
        <Button asChild size="sm" variant="ghost" className={cn("mb-3 -ml-2 text-muted-foreground", focus && "hidden")}>
          <Link href={listHref}>
            <ChevronLeft /> {t("studio.docs.allDocs")}
          </Link>
        </Button>
        <Editor
          key={doc?.id ?? `new:${newTemplate}`}
          businessId={businessId}
          doc={doc}
          template={newTemplate}
          initialFolder={filter.folder}
          folders={folders}
          author={author ? (names.get(author) ?? t("studio.docs.team")) : undefined}
          media={media}
          mentions={candidates}
          backHref={listHref}
          onHandOver={(hand) => setPeek({ kind: "hand", hand })}
          onShowLinks={() => setPeek({ kind: "links" })}
          canHand={teammates.some((m) => m.kind === "ai")}
        />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell title={t("nav.docs")} actions={<NewDocMenu businessId={businessId} filter={filter} />}>
      <DocsBrowser businessId={businessId} items={items} matches={matches} filter={filter} names={names} />
    </WorkspaceShell>
  );
}

/** "New doc": blank, or from one of the built-in templates. Opens in the folder being shown. */
function NewDocMenu({ businessId, filter, label }: { businessId: string; filter: DocsFilter; label?: string }) {
  const t = useT();
  const href = (key: string) => docsHref(businessId, filter, { new: key });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <PlusIcon /> {label ?? t("docs.new")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem asChild>
          <Link href={href("blank")}>
            <FileTextIcon /> {t("docs.blank")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-tertiary">{t("docs.fromTemplate")}</DropdownMenuLabel>
        {DOC_TEMPLATES.map((tpl) => (
          <DropdownMenuItem key={tpl.key} asChild>
            <Link href={href(tpl.key)}>
              <FileTextIcon /> {t(`docs.template.${tpl.key}`)}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const FOLDER_ERRORS: Record<string, MessageKey> = { "A folder can't go inside itself.": "docs.err.circular", "Pick a folder.": "docs.err.pickFolder" };

function DocsBrowser({
  businessId,
  items,
  matches,
  filter,
  names,
}: {
  businessId: string;
  items: DocItem[];
  matches: string[] | null;
  filter: DocsFilter;
  names: Map<string, string>;
}) {
  const t = useT();
  const tn = useTn();
  const kindLabel = useKindLabel();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Folders named here that have no docs yet (a folder exists once a doc is in it).
  const [newFolders, setNewFolders] = useState<string[]>([]);
  const [folderDialog, setFolderDialog] = useState<{ mode: "new" | "rename"; path?: string } | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [q, setQ] = useState(filter.q);

  const matchSet = useMemo(() => (matches ? new Set(matches) : null), [matches]);
  const shown = useMemo(() => filterDocs(items, filter, matchSet), [items, filter, matchSet]);
  const deliverables = items.filter((d) => d.source === "deliverable");
  const tree = useMemo(() => folderTree(deliverables.map((d) => d.folder), [...newFolders, ...(filter.folder ? [filter.folder] : [])]), [deliverables, newFolders, filter.folder]);
  const selectable = shown.filter((d) => d.source === "deliverable");
  const picked = selectable.filter((d) => selected.has(d.id)).map((d) => d.id);
  const allPicked = selectable.length > 0 && picked.length === selectable.length;
  const href = (f: Partial<DocsFilter>) => docsHref(businessId, { ...filter, ...f });
  const activeFilters = filter.who !== "all" || !!filter.status || !!filter.folder || !!filter.q;

  // Search as you type, on the server (both tables' full text), a moment after typing stops.
  const qRef = useRef(filter.q);
  useEffect(() => {
    if (q.trim() === qRef.current) return;
    const id = setTimeout(() => {
      qRef.current = q.trim();
      router.replace(docsHref(businessId, { ...filter, q: q.trim() }), { scroll: false });
    }, 300);
    return () => clearTimeout(id);
  }, [q, filter, businessId, router]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const move = (folder: string | null) =>
    start(async () => {
      const r = await moveDocsToFolder(businessId, picked, folder);
      toast(tn("docs.moved", r.moved));
      setSelected(new Set());
    });
  const mark = (status: DeliverableStatus) =>
    start(async () => {
      const r = await setStatusOfDocs(businessId, picked, status);
      toast(tn("docs.statusChanged", r.changed));
      setSelected(new Set());
    });
  const trash = () =>
    start(async () => {
      const r = await trashManyDocs(businessId, picked);
      toast(tn("docs.trashed", r.trashed));
      setSelected(new Set());
    });

  const authorOf = (d: DocItem) => {
    if (d.by === "owner") return t("studio.docs.you");
    const id = teammateOf(d.by);
    return (id && names.get(id)) || t("studio.docs.team");
  };
  const counts = { all: items.length, context: items.filter((d) => d.source === "context").length };

  return (
    <div className="grid gap-6 @3xl:grid-cols-[220px_minmax(0,1fr)]">
      {/* Folders */}
      <aside className="hidden min-w-0 @3xl:block">
        <nav aria-label={t("docs.folders")} className="space-y-0.5">
          <SideItem href={href({ folder: null, status: null })} active={!filter.folder && filter.status !== "context"} icon={<LayoutGrid />} label={t("docs.allDocs")} count={counts.all} />
          <SideItem href={href({ folder: null, status: "context" })} active={filter.status === "context"} icon={<BookOpen />} label={t("docs.teamReads")} count={counts.context} />
          <div className="flex items-center justify-between px-2 pt-4 pb-1">
            <span className="text-xs font-medium text-tertiary">{t("docs.folders")}</span>
            <Button size="icon-xs" variant="ghost" className="text-tertiary" aria-label={t("docs.newFolder")} onClick={() => setFolderDialog({ mode: "new" })}>
              <FolderPlus />
            </Button>
          </div>
          {tree.length === 0 && <p className="px-2 text-xs text-tertiary">{t("docs.noFolders")}</p>}
          {tree.map((f) => (
            <div key={f.path} className="group/folder relative" style={{ paddingLeft: f.depth * 12 }}>
              <SideItem
                href={href({ folder: f.path, status: filter.status === "context" ? null : filter.status })}
                active={filter.folder === f.path}
                icon={<FolderIcon />}
                label={f.name}
                count={f.total || undefined}
              />
              <MoreMenu
                label={t("docs.folderMenu")}
                size="icon-xs"
                className="absolute top-0.5 right-1 bg-background opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
              >
                <DropdownMenuItem onSelect={() => setFolderDialog({ mode: "rename", path: f.path })} disabled={f.total === 0}>
                  <Pencil /> {t("docs.renameFolder")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={docsHref(businessId, { folder: f.path }, { new: "blank" })}>
                    <PlusIcon /> {t("docs.newDocHere")}
                  </Link>
                </DropdownMenuItem>
              </MoreMenu>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("docs.search")} aria-label={t("docs.search")} className="h-7 w-full text-[13px] @xl:w-64" />
          <Select value={filter.who} onValueChange={(v) => router.push(href({ who: v as DocsFilter["who"] }))}>
            <SelectTrigger size="sm" aria-label={t("docs.source")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "mine", "team"] as const).map((w) => (
                <SelectItem key={w} value={w}>
                  {t(`docs.source.${w}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter.status ?? ANY} onValueChange={(v) => router.push(href({ status: v === ANY ? null : (v as DocStatus), folder: v === "context" ? null : filter.folder }))}>
            <SelectTrigger size="sm" aria-label={t("docs.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("docs.status.all")}</SelectItem>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "context" ? t("docs.teamReads") : t(statusTone("deliverable", s).label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Phone: folders as a picker */}
          <Select value={filter.folder ?? ANY} onValueChange={(v) => router.push(href({ folder: v === ANY ? null : v }))}>
            <SelectTrigger size="sm" aria-label={t("docs.folder")} className="@3xl:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("docs.allDocs")}</SelectItem>
              {tree.map((f) => (
                <SelectItem key={f.path} value={f.path}>
                  {f.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeFilters && (
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
              <Link href={docsHref(businessId, {})} onClick={() => setQ("")}>
                <XIcon /> {t("docs.clearFilters")}
              </Link>
            </Button>
          )}
        </div>

        {filter.folder && (
          <div className="mt-4 flex items-center gap-2">
            <FolderIcon className="size-4 text-tertiary" strokeWidth={1.75} />
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{filter.folder.split("/").join(" / ")}</span>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setFolderDialog({ mode: "rename", path: filter.folder! })}>
              <Pencil /> {t("docs.rename")}
            </Button>
          </div>
        )}

        {/* Bulk actions */}
        <div className={cn("mt-4 flex h-9 items-center gap-2 border-b border-border pb-2", !selectable.length && "hidden")}>
          <Checkbox
            checked={allPicked ? true : picked.length ? "indeterminate" : false}
            onCheckedChange={() => setSelected(allPicked ? new Set() : new Set(selectable.map((d) => d.id)))}
            aria-label={t("docs.selectAll")}
            className="ml-2"
          />
          {picked.length > 0 ? (
            <>
              <span className="text-[13px] text-foreground tabular-nums">{tn("docs.selected", picked.length)}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={pending}>
                    <FolderInput /> {t("docs.moveTo")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 min-w-48 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => move(null)}>{t("docs.topLevel")}</DropdownMenuItem>
                  {tree.map((f) => (
                    <DropdownMenuItem key={f.path} onSelect={() => move(f.path)}>
                      <FolderIcon /> {f.path}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setFolderDialog({ mode: "new" })}>
                    <FolderPlus /> {t("docs.newFolder")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={pending}>
                    <Tag /> {t("docs.markAs")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {DOC_STATUSES.map((s) => {
                    const st = statusTone("deliverable", s);
                    return (
                      <DropdownMenuItem key={s} onSelect={() => mark(s)}>
                        <Badge tone={st.tone}>{t(st.label)}</Badge>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setTrashing(true)}>
                <Trash2 /> {t("docs.moveToTrash")}
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => setSelected(new Set())}>
                {t("docs.clearSelection")}
              </Button>
            </>
          ) : (
            <span className="text-xs text-tertiary">{t("docs.selectAll")}</span>
          )}
        </div>

        {shown.length === 0 ? (
          filter.folder && !items.some((d) => d.source === "deliverable" && isInFolder(d.folder, filter.folder!)) ? (
            <EmptyState
              icon={<FolderIcon />}
              title={t("docs.folderEmptyTitle")}
              body={t("docs.folderEmptyBody")}
              action={<NewDocMenu businessId={businessId} filter={filter} label={t("docs.newDocHere")} />}
            />
          ) : (
            <EmptyState
              icon={<FileTextIcon />}
              title={items.length ? t("studio.docs.noMatch") : t("studio.docs.emptyTitle")}
              body={items.length ? undefined : t("studio.docs.emptyBody")}
            />
          )
        ) : (
          <ul className={cn("mt-1", pending && "opacity-60")}>
            {shown.map((d) => {
              const context = d.source === "context";
              const s = context ? { tone: "purple" as const, label: "docs.teamReads" as MessageKey } : statusTone("deliverable", d.status);
              const open = context ? mentionHref(businessId, { type: "doc", id: d.id }) : docsHref(businessId, filter, { doc: d.id });
              return (
                <li key={`${d.source}:${d.id}`} className="group/row flex items-center gap-2 rounded-md px-2 hover:bg-hover">
                  {context ? (
                    <span className="size-4 shrink-0" />
                  ) : (
                    <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} aria-label={t("docs.select", { title: d.title })} />
                  )}
                  <Link href={open} className="flex min-w-0 flex-1 items-center gap-3 py-2" title={context ? t("docs.teamReadsHelp") : undefined}>
                    {context ? (
                      <BookOpen className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} />
                    ) : (
                      <FileTextIcon className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-[18px] font-medium text-foreground">{d.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-tertiary">
                        {context ? t("nav.context") : kindLabel(d.kind)} · {authorOf(d)}
                        {d.folder && !filter.folder ? ` · ${d.folder}` : ""}
                        {d.folder && filter.folder && d.folder !== filter.folder ? ` · ${d.folder.slice(filter.folder.length + 1)}` : ""}
                      </span>
                    </span>
                    <Badge tone={s.tone} className="shrink-0">
                      {t(s.label)}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <FolderDialog
        state={folderDialog}
        parent={filter.folder}
        moveCount={picked.length}
        onClose={() => setFolderDialog(null)}
        onCreate={(path) => {
          setFolderDialog(null);
          if (picked.length) move(path);
          else setNewFolders((f) => [...f, path]);
          router.push(docsHref(businessId, { ...filter, folder: path, status: filter.status === "context" ? null : filter.status }));
        }}
        onRename={async (from, to) => {
          const r = await renameDocFolder(businessId, from, to);
          if ("error" in r) return FOLDER_ERRORS[r.error] ? t(FOLDER_ERRORS[r.error]) : r.error;
          setFolderDialog(null);
          toast(t("docs.folderRenamed"));
          setNewFolders((list) => list.filter((p) => !isInFolder(p, from)));
          if (filter.folder && isInFolder(filter.folder, from)) router.replace(docsHref(businessId, { ...filter, folder: to + filter.folder.slice(from.length) }));
          return null;
        }}
      />
      <DeleteDialog
        open={trashing}
        onOpenChange={setTrashing}
        title={tn("docs.trashTitle", picked.length)}
        body={t("docs.trashBody")}
        onConfirm={() => {
          setTrashing(false);
          trash();
        }}
      />
    </div>
  );
}

/** Name a new folder (under the one being shown), or rename one (its last part). */
function FolderDialog({
  state,
  parent,
  moveCount,
  onClose,
  onCreate,
  onRename,
}: {
  state: { mode: "new" | "rename"; path?: string } | null;
  parent: string | null;
  moveCount: number;
  onClose: () => void;
  onCreate: (path: string) => void;
  onRename: (from: string, to: string) => Promise<string | null>;
}) {
  const t = useT();
  const tn = useTn();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const renaming = state?.mode === "rename" && state.path;
  const [opened, setOpened] = useState<typeof state>(null);
  if (state !== opened) {
    setOpened(state);
    setName(renaming ? state.path!.slice(state.path!.lastIndexOf("/") + 1) : "");
    setError(null);
  }

  const submit = () => {
    if (!state) return;
    if (state.mode === "rename" && state.path) {
      const base = folderParent(state.path);
      const to = normalizeFolder(name.includes("/") ? name : [base, name].filter(Boolean).join("/"));
      if (!to) return setError(t("docs.err.pickFolder"));
      if (to === state.path) return onClose();
      start(async () => setError(await onRename(state.path!, to)));
    } else {
      const to = normalizeFolder([parent, name].filter(Boolean).join("/"));
      if (!to || !normalizeFolder(name)) return setError(t("docs.err.pickFolder"));
      onCreate(to);
    }
  };

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{renaming ? t("docs.renameFolderTitle", { name: state!.path! }) : t("docs.newFolder")}</DialogTitle>
          <DialogDescription>{renaming ? t("docs.renameFolderHelp") : t("docs.newFolderHelp")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-2"
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("docs.folderName")} aria-label={t("docs.folderName")} />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={pending || !name.trim()}>
              {renaming ? t("docs.rename") : moveCount ? tn("docs.newFolderMove", moveCount) : t("docs.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SideItem({ href, active, icon, label, count }: { href: string; active: boolean; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 pr-8 text-left text-[13px] leading-[18px] font-medium text-foreground transition-colors duration-100 hover:bg-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75] [&_svg]:text-tertiary",
        active && "bg-accent [&_svg]:text-foreground",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      <span className="text-xs font-normal text-tertiary tabular-nums">{count}</span>
    </Link>
  );
}
