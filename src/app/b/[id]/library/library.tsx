"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AudioLines,
  Bookmark,
  BookmarkPlus,
  Bot,
  Clapperboard,
  Copy,
  Download,
  FileIcon,
  FolderIcon,
  ImageIcon,
  LayoutGrid,
  ListChecks,
  MusicIcon,
  Pencil,
  StarIcon,
  Tag,
  Trash2,
  UploadIcon,
  UserRoundPlus,
  VideoIcon,
  X,
} from "lucide-react";
import { useT, useTn } from "@/components/i18n";
import { Button, cn, EmptyState, IconButton, Input, LineTabs, Textarea } from "@/components/kit";
import { Gallery, GalleryTile } from "@/components/data-table";
import { thumbUrl } from "@/lib/file-urls";
import { isTypingTarget, useShortcut } from "@/components/shortcuts";
import { useGrowingList } from "@/components/use-growing-list";
import { SidePeek } from "@/components/side-peek";
import { ObjectPanel } from "@/components/object-panel";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DuplicateGroup, LibraryItem } from "@/lib/assets";
import type { MessageKey } from "@/lib/i18n";
import { applyFilter, isEmptyFilter, mergeFilters, sameFilter, type LibraryFilter } from "@/lib/library-filter";
import type { LibraryUsage } from "@/lib/library-search";
import type { SmartAlbum } from "@/lib/library-views";
import { MEDIA_ACCEPT, type MediaKind } from "@/lib/media-types";
import {
  assetUsage,
  createSmartAlbum,
  deleteAssets,
  deleteSmartAlbum,
  findDuplicateAssets,
  organizeAssets,
  removeDuplicateAssets,
  searchAssets,
  updateSmartAlbum,
  type ViewResult,
} from "./actions";
import { PlanTask, type MateOption } from "@/components/plan-task";
import { DeleteDialog, MoreMenu, PropRow, WorkspaceShell } from "@/components/workspace-ui";

const KINDS: { key: MediaKind | "all"; label: MessageKey }[] = [
  { key: "all", label: "studio.lib.kind.all" },
  { key: "image", label: "studio.lib.kind.image" },
  { key: "video", label: "studio.lib.kind.video" },
  { key: "audio", label: "studio.lib.kind.audio" },
  { key: "file", label: "studio.lib.kind.file" },
];
const KIND_ICON = { image: ImageIcon, video: VideoIcon, audio: MusicIcon, file: FileIcon };
const NONE = "__none";
const NEW = "__new";

const VIEW_ERRORS: Record<Extract<ViewResult, { error: string }>["error"], MessageKey> = {
  name: "library.smartErr.name",
  empty: "library.smartErr.empty",
  tooMany: "library.smartErr.tooMany",
  notFound: "library.smartErr.notFound",
};

export const fileUrl = (businessId: string, rel: string) => `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

function size(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Keep the one open file in the URL (?f=) without a server round trip, so a reload keeps the peek. */
function syncPeekParam(paths: string[]) {
  const url = new URL(window.location.href);
  if (paths.length === 1) url.searchParams.set("f", paths[0]);
  else url.searchParams.delete("f");
  window.history.replaceState(window.history.state, "", url);
}

type UploadResult = { ok: boolean; statusText: string; json: { path?: string; error?: string; existing?: boolean } };

/** POST one file to the media route (the same one chat uses), reporting how much has gone up. */
function sendFile(url: string, file: File, onProgress: (fraction: number) => void) {
  return new Promise<UploadResult>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let json: UploadResult["json"] = {};
      try {
        json = JSON.parse(xhr.responseText) as UploadResult["json"];
      } catch {}
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, statusText: xhr.statusText, json });
    };
    xhr.onerror = () => resolve({ ok: false, statusText: "Network error", json: {} });
    xhr.send(file);
  });
}

/** What the sidebar shows: everything, a built-in pick, an album or a smart album. */
type Scope = { type: "all" } | { type: "starred" } | { type: "team" } | { type: "dupes" } | { type: "album"; name: string } | { type: "view"; id: string };

function scopeFilter(scope: Scope, views: SmartAlbum[]): LibraryFilter {
  switch (scope.type) {
    case "starred":
      return { starred: true };
    case "team":
      return { source: "team" };
    case "album":
      return { album: scope.name };
    case "view":
      return views.find((v) => v.id === scope.id)?.filter ?? {};
    default:
      return {};
  }
}

/** The media library, organized by the owner: albums, smart albums, tags, notes and stars, plus what the team made. */
export function Library({ businessId, items, views, teammates }: { businessId: string; items: LibraryItem[]; views: SmartAlbum[]; teammates: MateOption[] }) {
  const t = useT();
  const tn = useTn();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kindParam = params.get("kind");
  const kind: MediaKind | "all" = KINDS.some((k) => k.key === kindParam) ? (kindParam as MediaKind) : "all";
  const [scopeState, setScope] = useState<Scope>({ type: "all" });
  // A smart album deleted elsewhere falls back to everything.
  const scope: Scope = scopeState.type === "view" && !views.some((v) => v.id === scopeState.id) ? { type: "all" } : scopeState;
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [rank, setRank] = useState<{ q: string; paths: string[] } | null>(null);
  const [selected, setSelectedState] = useState<string[]>(() => {
    const f = params.get("f");
    return f && items.some((i) => i.path === f) ? [f] : [];
  });
  const anchor = useRef<string | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number; pct: number; error?: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [, startDelete] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null);
  const [removing, setRemoving] = useState<DuplicateGroup[] | null>(null);
  const [removePending, startRemove] = useTransition();
  const [deletingView, setDeletingView] = useState<SmartAlbum | null>(null);
  const dupView = scope.type === "dupes";
  const activeView = scope.type === "view" ? views.find((v) => v.id === scope.id) ?? null : null;

  // Only files that share a size get read, so checking on every change stays cheap.
  useEffect(() => {
    let live = true;
    void findDuplicateAssets(businessId).then((g) => live && setDupes(g));
    return () => {
      live = false;
    };
  }, [businessId, items]);
  const dupCount = dupes?.reduce((n, g) => n + g.copies.length, 0) ?? 0;

  // Full-text search (titles, notes, tags, albums, paths) plus file names, ranked on the server.
  useEffect(() => {
    const s = q.trim();
    if (!s) return;
    let live = true;
    const timer = setTimeout(() => void searchAssets(businessId, s).then((paths) => live && setRank({ q: s, paths })), 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [businessId, q, items]);
  const ranking = rank && rank.q === q.trim() ? rank.paths : null;

  const setSelected = (next: string[] | ((s: string[]) => string[])) =>
    setSelectedState((s) => {
      const v = typeof next === "function" ? next(s) : next;
      syncPeekParam(v);
      return v;
    });

  const albums = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.album) m.set(i.album, (m.get(i.album) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);
  const tags = useMemo(() => [...new Set(items.flatMap((i) => i.tags))].sort(), [items]);
  const starredCount = items.filter((i) => i.starred).length;
  const teamCount = items.filter((i) => i.source === "team").length;

  const base = scopeFilter(scope, views);
  const toolbar: LibraryFilter = { kind: kind === "all" ? undefined : kind, q, tags: tag ? [tag] : undefined };
  const shown = applyFilter(applyFilter(items, base), toolbar, ranking);
  const viewCounts = useMemo(() => new Map(views.map((v) => [v.id, applyFilter(items, v.filter).length])), [items, views]);
  // What "Save view" would save: the sidebar pick narrowed by the toolbar.
  const current = mergeFilters(base, toolbar);
  const canSave = !dupView && !isEmptyFilter(current) && !(activeView && sameFilter(activeView.filter, current));

  // Thousands of files: tiles render a slice at a time as you scroll.
  const { visible, sentinel } = useGrowingList(shown, [JSON.stringify(scope), kind, tag, q, ranking?.length ?? -1].join("\0"));
  const picked = items.filter((i) => selected.includes(i.path));
  const peekItem = picked.length === 1 ? picked[0] : null;
  const uploadAlbum = scope.type === "album" ? scope.name : (activeView?.filter.album ?? null);

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    const total = list.reduce((n, f) => n + f.size, 0) || 1;
    let sent = 0;
    setUploading({ done: 0, total: list.length, pct: 0 });
    const added: string[] = [];
    let already = 0;
    for (const [n, f] of list.entries()) {
      const res = await sendFile(`/api/b/${businessId}/media`, f, (frac) =>
        setUploading({ done: n, total: list.length, pct: Math.min(100, Math.round(((sent + frac * f.size) / total) * 100)) }),
      );
      if (!res.ok || !res.json.path) {
        setUploading({ done: n, total: list.length, pct: 0, error: `${f.name}: ${res.json.error ?? res.statusText}` });
        router.refresh();
        return;
      }
      sent += f.size;
      if (res.json.existing) already++;
      added.push(res.json.path);
      setUploading({ done: n + 1, total: list.length, pct: Math.round((sent / total) * 100) });
    }
    // New uploads land in the album you're looking at.
    if (uploadAlbum) await organizeAssets(businessId, added, { album: uploadAlbum });
    setUploading(null);
    setSelected(added);
    anchor.current = added.at(-1) ?? null;
    toast(already ? tn("studio.lib.alreadyHere", already) : tn("studio.lib.uploaded", added.length));
    router.refresh();
  };

  /** Shift: everything between the last picked file and this one. ⌘/Ctrl: add or drop one. */
  const pick = (path: string, { shift = false, add = false }: { shift?: boolean; add?: boolean }) => {
    const from = anchor.current ? shown.findIndex((i) => i.path === anchor.current) : -1;
    const to = shown.findIndex((i) => i.path === path);
    if (shift && from >= 0 && to >= 0) {
      const range = shown.slice(Math.min(from, to), Math.max(from, to) + 1).map((i) => i.path);
      setSelected((s) => [...new Set([...s, ...range])]);
      return;
    }
    anchor.current = path;
    if (add || shift) setSelected((s) => (s.includes(path) ? s.filter((x) => x !== path) : [...s, path]));
    else setSelected((s) => (s.length === 1 && s[0] === path ? [] : [path]));
  };
  const selectAll = () => {
    setSelected(shown.map((i) => i.path));
    anchor.current = shown[0]?.path ?? null;
  };

  // ⌘/Ctrl+A picks everything shown (not while typing); Delete/Backspace sends the pick to Trash.
  useEffect(() => {
    if (dupView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a" || isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")) return;
      e.preventDefault();
      selectAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useShortcut(["delete", "backspace"], () => setDeleting(selected), { enabled: selected.length > 0 && !deleting && !dupView });

  const show = (next: Scope) => {
    setScope((cur) => (JSON.stringify(cur) === JSON.stringify(next) && next.type !== "all" ? { type: "all" } : next));
    if (next.type === "dupes") setSelected([]);
  };
  const isScope = (s: Scope) => JSON.stringify(scope) === JSON.stringify(s);

  const kindHref = (k: string) => {
    const next = new URLSearchParams(params.toString());
    if (k === "all") next.delete("kind");
    else next.set("kind", k);
    next.delete("f");
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  const confirmRemove = () => {
    const groups = removing;
    setRemoving(null);
    if (!groups) return;
    startRemove(async () => {
      const n = await removeDuplicateAssets(businessId, groups);
      toast(tn("studio.lib.dupRemoved", n));
    });
  };

  const confirmDelete = () => {
    const paths = deleting;
    setDeleting(null);
    if (!paths) return;
    startDelete(async () => {
      await deleteAssets(businessId, paths);
      setSelected((s) => s.filter((p) => !paths.includes(p)));
      toast(tn("studio.lib.deleted", paths.length));
    });
  };

  const confirmDeleteView = () => {
    const v = deletingView;
    setDeletingView(null);
    if (!v) return;
    startDelete(async () => {
      await deleteSmartAlbum(businessId, v.id);
      if (scope.type === "view" && scope.id === v.id) setScope({ type: "all" });
      toast(t("library.smartDeleted"));
    });
  };

  /** Save the current filters as a new smart album (or into the open one), then open it. */
  const saveView = async (name: string | null) => {
    const res = activeView && name === null ? await updateSmartAlbum(businessId, activeView.id, { filter: current }) : await createSmartAlbum(businessId, name ?? "", current);
    if ("error" in res) {
      toast.error(t(VIEW_ERRORS[res.error]));
      return false;
    }
    toast(name === null ? t("library.smartUpdated") : t("library.smartSaved"));
    // The album holds the toolbar's filters now: clear them so they aren't applied twice.
    setScope({ type: "view", id: res.id });
    setQ("");
    setTag(null);
    if (kind !== "all") router.replace(kindHref("all"));
    return true;
  };

  const renameView = async (v: SmartAlbum, name: string) => {
    const res = await updateSmartAlbum(businessId, v.id, { name });
    if ("error" in res) toast.error(t(VIEW_ERRORS[res.error]));
    return !("error" in res);
  };

  const peek = (
    <SidePeek
      open={!!peekItem}
      onClose={() => setSelected([])}
      title={peekItem ? peekItem.title || peekItem.name : undefined}
      description={t("studio.lib.peekDescription")}
      actions={
        peekItem && (
          <MoreMenu label={t("studio.more")}>
            <DropdownMenuItem asChild>
              <a href={`${fileUrl(businessId, peekItem.path)}?download=1`}>
                <Download /> {t("studio.lib.download")}
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting([peekItem.path])}>
              <Trash2 /> {t("common.delete")}
            </DropdownMenuItem>
          </MoreMenu>
        )
      }
    >
      {peekItem && <Inspector key={peekItem.path} businessId={businessId} item={peekItem} albums={albums.map((a) => a[0])} teammates={teammates} />}
    </SidePeek>
  );

  return (
    <WorkspaceShell title={t("nav.library")} peek={peek}>
      <div
        className="grid gap-6 @3xl:grid-cols-[220px_minmax(0,1fr)]"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          setDragging(false);
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }}
      >
        {/* Albums & tags */}
        <aside className="min-w-0 space-y-4">
          <Button size="sm" className="@3xl:w-full" onClick={() => fileInput.current?.click()} disabled={!!uploading && !uploading.error} loading={!!uploading && !uploading.error}>
            <UploadIcon /> {t("studio.lib.upload")}
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={MEDIA_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Phone: one scrolling row of chips */}
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] @3xl:hidden">
            <Chip active={isScope({ type: "all" })} onClick={() => show({ type: "all" })}>
              {t("studio.lib.everything")}
            </Chip>
            <Chip active={isScope({ type: "starred" })} onClick={() => show({ type: "starred" })}>
              <StarIcon className="size-3.5" /> {t("studio.lib.starred")}
            </Chip>
            {teamCount > 0 && (
              <Chip active={isScope({ type: "team" })} onClick={() => show({ type: "team" })}>
                <Bot className="size-3.5" /> {t("library.fromTeam")}
              </Chip>
            )}
            {(dupCount > 0 || dupView) && (
              <Chip active={dupView} onClick={() => show({ type: "dupes" })}>
                <Copy className="size-3.5" /> {t("studio.lib.duplicates")} {dupCount > 0 && <span className="tabular-nums">{dupCount}</span>}
              </Chip>
            )}
            {views.map((v) => (
              <Chip key={v.id} active={isScope({ type: "view", id: v.id })} onClick={() => show({ type: "view", id: v.id })}>
                <Bookmark className="size-3.5" /> {v.name}
              </Chip>
            ))}
            {albums.map(([a]) => (
              <Chip key={a} active={isScope({ type: "album", name: a })} onClick={() => show({ type: "album", name: a })}>
                <FolderIcon className="size-3.5" /> {a}
              </Chip>
            ))}
            {tags.map((tg) => (
              <Chip key={`#${tg}`} active={tag === tg} onClick={() => setTag(tag === tg ? null : tg)}>
                #{tg}
              </Chip>
            ))}
          </div>

          {/* Desktop: a Notion-like list */}
          <nav aria-label={t("studio.lib.albums")} className="hidden space-y-0.5 @3xl:block">
            <SideItem active={isScope({ type: "all" })} onClick={() => show({ type: "all" })} icon={<LayoutGrid />} label={t("studio.lib.everything")} count={items.length} />
            <SideItem active={isScope({ type: "starred" })} onClick={() => show({ type: "starred" })} icon={<StarIcon />} label={t("studio.lib.starred")} count={starredCount} />
            <SideItem active={isScope({ type: "team" })} onClick={() => show({ type: "team" })} icon={<Bot />} label={t("library.fromTeam")} count={teamCount} />
            <SideItem active={dupView} onClick={() => show({ type: "dupes" })} icon={<Copy />} label={t("studio.lib.duplicates")} count={dupes ? dupCount : undefined} />
            <div className="px-2 pt-4 pb-1 text-xs font-medium text-tertiary">{t("library.smart")}</div>
            {views.length === 0 && <p className="px-2 text-xs text-tertiary">{t("library.smartNone")}</p>}
            {views.map((v) => (
              <SmartAlbumItem
                key={v.id}
                view={v}
                active={isScope({ type: "view", id: v.id })}
                count={viewCounts.get(v.id)}
                onOpen={() => show({ type: "view", id: v.id })}
                onRename={(name) => renameView(v, name)}
                onDelete={() => setDeletingView(v)}
              />
            ))}
            <div className="px-2 pt-4 pb-1 text-xs font-medium text-tertiary">{t("studio.lib.albums")}</div>
            {albums.length === 0 && <p className="px-2 text-xs text-tertiary">{t("studio.lib.noAlbums")}</p>}
            {albums.map(([a, n]) => (
              <SideItem key={a} active={isScope({ type: "album", name: a })} onClick={() => show({ type: "album", name: a })} icon={<FolderIcon />} label={a} count={n} />
            ))}
            {tags.length > 0 && (
              <>
                <div className="px-2 pt-4 pb-1.5 text-xs font-medium text-tertiary">{t("studio.lib.tags")}</div>
                <div className="flex flex-wrap gap-1 px-2">
                  {tags.map((tg) => (
                    <button
                      key={tg}
                      type="button"
                      aria-pressed={tag === tg}
                      onClick={() => setTag(tag === tg ? null : tg)}
                      className={cn(
                        "inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-medium transition-colors duration-100",
                        tag === tg ? "bg-tag-blue-bg text-tag-blue-fg" : "bg-tag-gray-bg text-tag-gray-fg hover:bg-hover-strong",
                      )}
                    >
                      {tg}
                    </button>
                  ))}
                </div>
              </>
            )}
          </nav>
        </aside>

        {/* Gallery */}
        {dupView ? (
          <Duplicates
            businessId={businessId}
            groups={dupes}
            byPath={new Map(items.map((i) => [i.path, i]))}
            pending={removePending}
            onOpen={(p) => setSelected([p])}
            onRemove={setRemoving}
          />
        ) : (
          <div className="min-w-0">
            <LineTabs
              label={t("studio.lib.kinds")}
              items={KINDS.map((k) => ({ href: kindHref(k.key), label: t(k.label), active: kind === k.key }))}
              trailing={
                <Input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("studio.lib.search")}
                  aria-label={t("studio.lib.search")}
                  className="hidden h-7 w-56 text-[13px] @xl:block"
                />
              }
            />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("studio.lib.search")} aria-label={t("studio.lib.search")} className="mt-3 h-8 @xl:hidden" />
            {items.length > 0 && (
              <div className="mt-3 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-tertiary tabular-nums">{tn("library.count", shown.length)}</span>
                {shown.length > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectAll}>
                    <ListChecks /> {t("library.selectAll")}
                  </Button>
                )}
                <span className="flex-1" />
                {canSave && <SaveViewButton activeView={activeView} onSave={saveView} />}
              </div>
            )}
            {uploading && (
              <div role="status" className="mt-3 space-y-1.5">
                <p className={cn("text-xs", uploading.error ? "text-destructive" : "text-muted-foreground")}>
                  {uploading.error ?? t("library.uploadingPct", { n: Math.min(uploading.done + 1, uploading.total), total: uploading.total, pct: uploading.pct })}
                </p>
                {!uploading.error && (
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${uploading.pct}%` }} />
                  </div>
                )}
              </div>
            )}
            <div
              className={cn(
                "relative mt-4 rounded-lg outline-2 outline-offset-4 outline-transparent transition-[outline-color] duration-100",
                dragging && "outline-dashed outline-ring",
              )}
            >
              {dragging && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background shadow-menu">
                    <UploadIcon className="size-3.5" /> {uploadAlbum ? t("library.dropInto", { album: uploadAlbum }) : t("library.dropHere")}
                  </span>
                </div>
              )}
              {items.length === 0 ? (
                <EmptyState
                  icon={<UploadIcon />}
                  title={t("studio.lib.emptyTitle")}
                  body={t("studio.lib.emptyBody")}
                  action={
                    <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
                      <UploadIcon /> {t("studio.lib.upload")}
                    </Button>
                  }
                />
              ) : shown.length === 0 ? (
                <EmptyState compact icon={<LayoutGrid />} title={t("studio.lib.noMatch")} body={t("studio.lib.noMatchBody")} />
              ) : (
                <Gallery className="grid-cols-2 gap-3 @xl:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] @xl:gap-4">
                  {visible.map((i, n) => {
                    const Icon = KIND_ICON[i.kind];
                    const on = selected.includes(i.path);
                    return (
                      <GalleryTile
                        key={i.path}
                        selected={on}
                        onClick={(e) => pick(i.path, { shift: e.shiftKey, add: e.metaKey || e.ctrlKey })}
                        caption={<span title={i.title || i.name}>{i.title || i.name}</span>}
                        meta={
                          <span className="flex min-w-0 items-center gap-1" title={i.note || undefined}>
                            {i.source === "team" ? <Bot className="size-3 shrink-0" aria-label={t("library.madeByTeam")} /> : <Icon className="size-3 shrink-0" />}
                            <span className="truncate">{[i.album, ...i.tags.map((tg) => `#${tg}`)].filter(Boolean).join(" · ") || size(i.bytes)}</span>
                          </span>
                        }
                        thumb={<Thumb businessId={businessId} item={i} eager={n < 30} />}
                        topLeft={
                          <span className="flex size-6 items-center justify-center rounded-md bg-background/90 shadow-xs">
                            <Checkbox
                              checked={on}
                              onClick={(e) => pick(i.path, { shift: e.shiftKey, add: true })}
                              aria-label={t("studio.lib.select", { name: i.title || i.name })}
                            />
                          </span>
                        }
                        badge={
                          i.starred || i.source === "team" ? (
                            <span className="flex h-6 items-center gap-1 rounded-md bg-background/90 px-1.5 text-[11px] font-medium text-muted-foreground shadow-xs">
                              {i.source === "team" && t("library.teamBadge")}
                              {i.starred && <StarIcon className="size-3.5 fill-tag-yellow-bg text-warning" />}
                            </span>
                          ) : undefined
                        }
                      />
                    );
                  })}
                </Gallery>
              )}
              {sentinel}
            </div>
            {items.length > 0 && <p className="mt-6 text-xs text-tertiary">{t("library.tip")}</p>}
          </div>
        )}
      </div>

      {picked.length > 1 && (
        <BulkBar
          businessId={businessId}
          items={picked}
          albums={albums.map((a) => a[0])}
          teammates={teammates}
          onClear={() => setSelected([])}
          onDelete={() => setDeleting(picked.map((i) => i.path))}
        />
      )}

      <DeleteDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={tn("studio.lib.dupConfirm", removing?.reduce((n, g) => n + g.copies.length, 0) ?? 0)}
        body={t("studio.lib.dupConfirmBody")}
        onConfirm={confirmRemove}
      />

      <DeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={
          deleting?.length === 1
            ? t("studio.lib.deleteOne", { name: (() => { const it = items.find((i) => i.path === deleting[0]); return it?.title || it?.name || ""; })() })
            : tn("studio.lib.deleteMany", deleting?.length ?? 0)
        }
        body={t("studio.lib.deleteBody")}
        onConfirm={confirmDelete}
      />

      <DeleteDialog
        open={!!deletingView}
        onOpenChange={(o) => !o && setDeletingView(null)}
        title={t("library.smartDeleteTitle", { name: deletingView?.name ?? "" })}
        body={t("library.smartDeleteBody")}
        onConfirm={confirmDeleteView}
      />
    </WorkspaceShell>
  );
}

/** "Save view": name the current filters as a smart album, or save them into the open one. */
function SaveViewButton({ activeView, onSave }: { activeView: SmartAlbum | null; onSave: (name: string | null) => Promise<boolean> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      {activeView && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={pending} onClick={() => start(async () => void (await onSave(null)))}>
          <Bookmark /> {t("library.smartUpdate", { name: activeView.name })}
        </Button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={pending}>
            <BookmarkPlus /> {t("library.smartSaveShort")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                if (await onSave(name)) {
                  setName("");
                  setOpen(false);
                }
              });
            }}
          >
            <span className="text-xs font-medium text-tertiary">{t("library.smartSave")}</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("library.smartNamePlaceholder")}
              aria-label={t("library.smartNameLabel")}
              className="h-7 text-[13px]"
            />
            <Button size="sm" type="submit" loading={pending} disabled={pending || !name.trim()}>
              {t("common.save")}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** A smart album in the sidebar: opens on click; rename inline or delete from its "…" menu. */
function SmartAlbumItem({
  view,
  active,
  count,
  onOpen,
  onRename,
  onDelete,
}: {
  view: SmartAlbum;
  active: boolean;
  count?: number;
  onOpen: () => void;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view.name);
  const [pending, start] = useTransition();
  if (renaming)
    return (
      <form
        className="px-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            if (name.trim() === view.name || (await onRename(name))) setRenaming(false);
          });
        }}
      >
        <Input
          autoFocus
          value={name}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setName(view.name);
              setRenaming(false);
            }
          }}
          aria-label={t("library.smartNameLabel")}
          className="h-7 text-[13px]"
        />
      </form>
    );
  return (
    <div className="group/view relative">
      <SideItem active={active} onClick={onOpen} icon={<Bookmark />} label={view.name} count={count} />
      <div className="absolute top-0.5 right-1 opacity-0 transition-opacity duration-100 group-focus-within/view:opacity-100 group-hover/view:opacity-100 has-[[aria-expanded=true]]:opacity-100">
        <MoreMenu label={t("library.smartActions")} size="icon-xs" className="bg-background">
          <DropdownMenuItem
            onSelect={() => {
              setName(view.name);
              setRenaming(true);
            }}
          >
            <Pencil /> {t("library.smartRename")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> {t("library.smartDelete")}
          </DropdownMenuItem>
        </MoreMenu>
      </div>
    </div>
  );
}

function Thumb({ businessId, item: i, eager }: { businessId: string; item: LibraryItem; eager?: boolean }) {
  const Icon = KIND_ICON[i.kind];
  if (i.kind === "image")
    // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
    return <img src={thumbUrl(businessId, i.path, i.mtime)} alt={i.title || i.name} loading={eager ? "eager" : "lazy"} />;
  if (i.kind === "video")
    // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
    return <img src={thumbUrl(businessId, i.path, i.mtime)} alt={i.title || i.name} loading={eager ? "eager" : "lazy"} />;
  return (
    <span className="flex size-full items-center justify-center text-placeholder">
      <Icon className="size-8" strokeWidth={1.5} />
    </span>
  );
}

/** Files with the same content, one group per row: the kept file first, then its copies. */
function Duplicates({
  businessId,
  groups,
  byPath,
  pending,
  onOpen,
  onRemove,
}: {
  businessId: string;
  groups: DuplicateGroup[] | null;
  byPath: Map<string, LibraryItem>;
  pending: boolean;
  onOpen: (path: string) => void;
  onRemove: (groups: DuplicateGroup[]) => void;
}) {
  const t = useT();
  const tn = useTn();
  if (!groups) return <p className="min-w-0 py-2 text-[13px] text-muted-foreground">{t("studio.lib.dupChecking")}</p>;
  if (!groups.length) return <EmptyState compact icon={<Copy />} title={t("studio.lib.dupNone")} body={t("studio.lib.dupNoneBody")} />;
  const freed = groups.reduce((n, g) => n + g.bytes * g.copies.length, 0);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{tn("studio.lib.dupSummary", groups.length, { size: size(freed) })}</div>
          <p className="mt-0.5 text-xs text-tertiary">{t("studio.lib.dupHint")}</p>
        </div>
        <Button size="sm" variant="danger" disabled={pending} loading={pending} onClick={() => onRemove(groups)}>
          <Trash2 /> {t("studio.lib.dupRemoveAll")}
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {groups.map((g) => {
          const files = [g.keep, ...g.copies].map((p) => byPath.get(p)).filter((i): i is LibraryItem => !!i);
          return (
            <li key={g.keep} className="flex flex-col gap-3 py-4 @xl:flex-row @xl:items-center">
              <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto [scrollbar-width:none]">
                {files.map((i, n) => (
                  <button key={i.path} type="button" onClick={() => onOpen(i.path)} className="w-32 shrink-0 text-left">
                    <span
                      className={cn(
                        "relative block aspect-[4/3] overflow-hidden rounded-md bg-muted ring-1 ring-black/5 ring-inset [&_img]:size-full [&_img]:object-cover [&_video]:size-full [&_video]:object-cover",
                        n === 0 && "ring-2 ring-success",
                      )}
                    >
                      <Thumb businessId={businessId} item={i} />
                      <span
                        className={cn(
                          "absolute top-1.5 left-1.5 rounded-sm px-1.5 text-[11px] leading-4 font-medium",
                          n === 0 ? "bg-tag-green-bg text-tag-green-fg" : "bg-background/90 text-muted-foreground",
                        )}
                      >
                        {n === 0 ? t("studio.lib.dupKeep") : t("studio.lib.dupCopy")}
                      </span>
                    </span>
                    <span className="mt-1.5 block truncate text-xs font-medium" title={i.name}>
                      {i.title || i.name}
                    </span>
                    <span className="block truncate text-[11px] text-tertiary">
                      {new Date(i.mtime).toLocaleDateString()} · {size(i.bytes)}
                    </span>
                  </button>
                ))}
              </div>
              <Button size="sm" variant="secondary" className="self-start @xl:self-center" disabled={pending} onClick={() => onRemove([g])}>
                <Trash2 /> {tn("studio.lib.dupRemove", g.copies.length)}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SideItem({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-[18px] font-medium text-foreground transition-colors duration-100 hover:bg-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75] [&_svg]:text-tertiary",
        active && "bg-accent [&_svg]:text-foreground",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      <span className="text-xs font-normal text-tertiary tabular-nums">{count}</span>
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[13px] whitespace-nowrap transition-colors duration-100",
        active ? "border-transparent bg-foreground text-background" : "border-border text-foreground hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

/** Album picker: existing albums, "No album", or "New album…" (then a text field). */
function AlbumSelect({ value, onChange, albums }: { value: string; onChange: (v: string) => void; albums: string[] }) {
  const t = useT();
  const [creating, setCreating] = useState(!!value && !albums.includes(value));
  const nameRef = useRef<HTMLInputElement>(null);
  const focusName = useRef(false);
  return (
    <div className="flex w-full min-w-0 gap-2">
      <Select
        value={creating ? NEW : value || NONE}
        onValueChange={(v) => {
          if (v === NEW) {
            setCreating(true);
            focusName.current = true;
            onChange("");
          } else {
            setCreating(false);
            onChange(v === NONE ? "" : v);
          }
        }}
      >
        <SelectTrigger size="sm" className={cn(creating ? "w-32 shrink-0" : "w-full")} aria-label={t("studio.lib.album")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          onCloseAutoFocus={(e) => {
            // After "New album…", type the name right away instead of landing back on the trigger.
            if (!focusName.current) return;
            focusName.current = false;
            e.preventDefault();
            requestAnimationFrame(() => nameRef.current?.focus());
          }}
        >
          <SelectItem value={NONE}>{t("studio.lib.noAlbum")}</SelectItem>
          {albums.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW}>{t("studio.lib.newAlbum")}</SelectItem>
        </SelectContent>
      </Select>
      {creating && <Input ref={nameRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("studio.lib.albumName")} className="h-7 min-w-0 flex-1 text-[13px]" />}
    </div>
  );
}

function Inspector({ businessId, item, albums, teammates }: { businessId: string; item: LibraryItem; albums: string[]; teammates: MateOption[] }) {
  const t = useT();
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note);
  const [tagText, setTagText] = useState(item.tags.join(", "));
  const [album, setAlbum] = useState(item.album ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const dirty = title !== item.title || note !== item.note || tagText !== item.tags.join(", ") || album !== (item.album ?? "");
  const url = fileUrl(businessId, item.path);
  const save = () =>
    start(async () => {
      await organizeAssets(businessId, [item.path], { title, note, tags: tagText.split(","), album: album || null });
      setSaved(true);
    });
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-lg bg-muted">
        {item.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
          <img src={url} alt={item.title || item.name} className="max-h-72 w-full object-contain" />
        ) : item.kind === "video" ? (
          <video src={url} controls playsInline className="max-h-72 w-full bg-stage" />
        ) : item.kind === "audio" ? (
          <div className="p-4">
            <audio src={url} controls className="w-full" />
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-tertiary">{t("studio.lib.noPreview")}</div>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-mono text-xs text-muted-foreground" title={item.path}>
          {item.name}
        </div>
        <div className="text-xs text-tertiary">
          {size(item.bytes)} · {new Date(item.mtime).toLocaleDateString()}
          {item.source === "team" && <> · {t("library.madeByTeam")}</>}
        </div>
      </div>
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onChange={() => setSaved(false)}
      >
        <PropRow label={t("studio.lib.title")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("studio.lib.titlePlaceholder")} className="h-7 text-[13px]" />
        </PropRow>
        <PropRow label={t("studio.lib.album")}>
          <AlbumSelect
            value={album}
            onChange={(v) => {
              setAlbum(v);
              setSaved(false);
            }}
            albums={albums}
          />
        </PropRow>
        <PropRow label={t("studio.lib.tags")}>
          <Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder={t("studio.lib.tagsPlaceholder")} className="h-7 text-[13px]" />
        </PropRow>
        <PropRow label={t("studio.lib.starred")}>
          <Switch
            checked={item.starred}
            disabled={pending}
            onCheckedChange={() => start(async () => void (await organizeAssets(businessId, [item.path], { starred: !item.starred })))}
            aria-label={item.starred ? t("studio.lib.unstar") : t("studio.lib.star")}
          />
          <span className="text-xs text-tertiary">{t("studio.lib.starHint")}</span>
        </PropRow>
        <div className="pt-2">
          <span className="mb-1.5 block text-[13px] leading-[18px] text-tertiary">{t("studio.lib.note")}</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={t("studio.lib.notePlaceholder")} className="text-[13px]" />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Button type="submit" size="sm" loading={pending && dirty} disabled={pending || !dirty}>
            {pending && dirty ? t("common.saving") : t("common.save")}
          </Button>
          {saved && !dirty && <span className="text-xs text-tertiary">{t("common.saved")}</span>}
        </div>
      </form>
      {(item.kind === "video" || item.kind === "audio") && (
        <div className="flex flex-wrap gap-2">
          {item.kind === "video" && (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/b/${businessId}/studio/video?add=${encodeURIComponent(item.path)}`}>
                <Clapperboard /> {t("studio.lib.editVideo")}
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="secondary">
            <Link href={`/b/${businessId}/studio/audio?file=${encodeURIComponent(item.path)}`}>
              <AudioLines /> {t("studio.lib.editAudio")}
            </Link>
          </Button>
        </div>
      )}
      <UsedIn businessId={businessId} path={item.path} />
      <ObjectPanel businessId={businessId} objectRef={{ type: "asset", id: item.path }} />
      <div className="border-t border-border pt-5">
        <PlanTask businessId={businessId} teammates={teammates} attachments={[item.path]} />
      </div>
    </div>
  );
}

/** Docs, work and tasks that carry this file, and what links to it; each opens the item. */
function UsedIn({ businessId, path }: { businessId: string; path: string }) {
  const t = useT();
  const [usage, setUsage] = useState<LibraryUsage | null>(null);
  useEffect(() => {
    let live = true;
    void assetUsage(businessId, path).then((u) => live && setUsage(u));
    return () => {
      live = false;
    };
  }, [businessId, path]);
  if (!usage) return null;
  const groups: { label: MessageKey; refs: { type: string; id: string; title: string; href: string }[] }[] = [
    { label: "library.usedInDocs", refs: usage.deliverables },
    { label: "library.usedInTasks", refs: usage.tasks },
    { label: "library.usedInLinks", refs: usage.links },
  ];
  const empty = groups.every((g) => !g.refs.length);
  return (
    <section className="border-t border-border pt-5" aria-label={t("library.usedIn")}>
      <h3 className="mb-2 text-[13px] font-medium text-foreground">{t("library.usedIn")}</h3>
      {empty ? (
        <p className="text-xs text-tertiary">{t("library.usedInNone")}</p>
      ) : (
        <div className="space-y-3">
          {groups
            .filter((g) => g.refs.length)
            .map((g) => (
              <div key={g.label}>
                <div className="mb-1 text-xs text-tertiary">{t(g.label)}</div>
                <ul className="space-y-0.5">
                  {g.refs.map((r) => (
                    <li key={`${r.type}:${r.id}`}>
                      <Link href={r.href} className="block truncate rounded-sm text-[13px] text-muted-foreground hover:text-foreground hover:underline">
                        {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

/** The floating "n selected" bar for several files: album, tags, star, make a video, plan, delete. */
function BulkBar({
  businessId,
  items,
  albums,
  teammates,
  onClear,
  onDelete,
}: {
  businessId: string;
  items: LibraryItem[];
  albums: string[];
  teammates: MateOption[];
  onClear: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const tn = useTn();
  const [album, setAlbum] = useState("");
  const [tagText, setTagText] = useState("");
  const [albumOpen, setAlbumOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [pending, start] = useTransition();
  const paths = items.map((i) => i.path);
  const videos = items.filter((i) => i.kind === "video");
  const allStarred = items.every((i) => i.starred);
  useShortcut("escape", onClear, { enabled: !albumOpen && !tagsOpen && !planOpen });
  return (
    <div
      role="toolbar"
      aria-label={tn("studio.lib.selected", items.length)}
      className="fixed bottom-[calc(var(--bottombar-h)+env(safe-area-inset-bottom)+16px)] left-1/2 z-40 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border border-border bg-background p-1 shadow-menu duration-150 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
    >
      <span className="px-2 text-[13px] font-medium whitespace-nowrap text-foreground tabular-nums">{tn("studio.lib.selected", items.length)}</span>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

      <Popover open={albumOpen} onOpenChange={setAlbumOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" disabled={pending}>
            <FolderIcon /> <span className="hidden sm:inline">{t("studio.lib.album")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-64">
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                await organizeAssets(businessId, paths, { album: album || null });
                setAlbumOpen(false);
                toast(album ? t("studio.lib.movedTo", { album }) : t("studio.lib.removedFromAlbum"));
              });
            }}
          >
            <span className="text-xs font-medium text-tertiary">{t("studio.lib.moveToAlbum")}</span>
            <AlbumSelect value={album} onChange={setAlbum} albums={albums} />
            <Button size="sm" type="submit" loading={pending} disabled={pending}>
              {t("studio.lib.set")}
            </Button>
          </form>
        </PopoverContent>
      </Popover>

      <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" disabled={pending}>
            <Tag /> <span className="hidden sm:inline">{t("studio.lib.tags")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-64">
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                await organizeAssets(businessId, paths, {}, tagText.split(","));
                setTagText("");
                setTagsOpen(false);
                toast(t("studio.lib.tagsAdded"));
              });
            }}
          >
            <span className="text-xs font-medium text-tertiary">{t("studio.lib.addTags")}</span>
            <Input autoFocus value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder={t("studio.lib.tagsPlaceholder")} className="h-7 text-[13px]" />
            <Button size="sm" type="submit" loading={pending} disabled={pending || !tagText.trim()}>
              {t("studio.lib.add")}
            </Button>
          </form>
        </PopoverContent>
      </Popover>

      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await organizeAssets(businessId, paths, { starred: !allStarred })))}>
        <StarIcon className={cn(allStarred && "fill-tag-yellow-bg text-warning")} /> <span className="hidden sm:inline">{allStarred ? t("studio.lib.unstarAll") : t("studio.lib.starAll")}</span>
      </Button>

      {videos.length > 0 && (
        <Button asChild size="sm" variant="ghost">
          <Link href={`/b/${businessId}/studio/video?${videos.map((v) => `add=${encodeURIComponent(v.path)}`).join("&")}`}>
            <Clapperboard /> <span className="whitespace-nowrap">{tn("studio.lib.makeVideo", videos.length)}</span>
          </Link>
        </Button>
      )}

      <Popover open={planOpen} onOpenChange={setPlanOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost">
            <UserRoundPlus /> <span className="hidden whitespace-nowrap sm:inline">{t("studio.lib.handOver")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-80 p-3">
          <PlanTask businessId={businessId} teammates={teammates} attachments={paths} onDone={() => setPlanOpen(false)} />
        </PopoverContent>
      </Popover>

      <Button size="sm" variant="danger" disabled={pending} onClick={onDelete}>
        <Trash2 /> <span className="hidden sm:inline">{t("common.delete")}</span>
      </Button>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      <IconButton label={t("studio.lib.clearSelection")} shortcut="Esc" side="top" onClick={onClear}>
        <X />
      </IconButton>
    </div>
  );
}
