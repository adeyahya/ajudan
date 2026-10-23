"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AudioLines,
  Clapperboard,
  Copy,
  Download,
  FileIcon,
  FolderIcon,
  ImageIcon,
  LayoutGrid,
  MusicIcon,
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
import { useShortcut } from "@/components/shortcuts";
import { SidePeek } from "@/components/side-peek";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DuplicateGroup, LibraryItem } from "@/lib/assets";
import type { MessageKey } from "@/lib/i18n";
import { MEDIA_ACCEPT, type MediaKind } from "@/lib/media-types";
import { deleteAssets, findDuplicateAssets, organizeAssets, removeDuplicateAssets } from "./actions";
import { PlanTask, type MateOption } from "./_components/plan-task";
import { DeleteDialog, MoreMenu, PropRow, StudioShell } from "./_components/studio-shell";

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

/** The media library, organized by the owner: albums, tags, notes and stars. */
export function Library({ businessId, items, teammates }: { businessId: string; items: LibraryItem[]; teammates: MateOption[] }) {
  const t = useT();
  const tn = useTn();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kindParam = params.get("kind");
  const kind: MediaKind | "all" = KINDS.some((k) => k.key === kindParam) ? (kindParam as MediaKind) : "all";
  const [album, setAlbum] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelectedState] = useState<string[]>(() => {
    const f = params.get("f");
    return f && items.some((i) => i.path === f) ? [f] : [];
  });
  const [uploading, setUploading] = useState<{ done: number; total: number; error?: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [, startDelete] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dupView, setDupView] = useState(false);
  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null);
  const [removing, setRemoving] = useState<DuplicateGroup[] | null>(null);
  const [removePending, startRemove] = useTransition();

  // Only files that share a size get read, so checking on every change stays cheap.
  useEffect(() => {
    let live = true;
    void findDuplicateAssets(businessId).then((g) => live && setDupes(g));
    return () => {
      live = false;
    };
  }, [businessId, items]);
  const dupCount = dupes?.reduce((n, g) => n + g.copies.length, 0) ?? 0;

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

  const shown = items.filter((i) => {
    if (kind !== "all" && i.kind !== kind) return false;
    if (album && i.album !== album) return false;
    if (tag && !i.tags.includes(tag)) return false;
    if (starredOnly && !i.starred) return false;
    const s = q.trim().toLowerCase();
    if (s && ![i.name, i.title, i.note, i.album ?? "", ...i.tags].some((x) => x.toLowerCase().includes(s))) return false;
    return true;
  });
  const picked = items.filter((i) => selected.includes(i.path));
  const peekItem = picked.length === 1 ? picked[0] : null;

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    setUploading({ done: 0, total: list.length });
    const added: string[] = [];
    let already = 0;
    for (const [n, f] of list.entries()) {
      const res = await fetch(`/api/b/${businessId}/media`, { method: "POST", headers: { "X-File-Name": encodeURIComponent(f.name) }, body: f });
      const j = (await res.json().catch(() => ({}))) as { path?: string; error?: string; existing?: boolean };
      if (!res.ok || !j.path) {
        setUploading({ done: n, total: list.length, error: `${f.name}: ${j.error ?? res.statusText}` });
        router.refresh();
        return;
      }
      if (j.existing) already++;
      added.push(j.path);
      setUploading({ done: n + 1, total: list.length });
    }
    // New uploads land in the album you're looking at.
    if (album) await organizeAssets(businessId, added, { album });
    setUploading(null);
    setSelected(added);
    toast(already ? tn("studio.lib.alreadyHere", already) : tn("studio.lib.uploaded", added.length));
    router.refresh();
  };

  const click = (path: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) setSelected((s) => (s.includes(path) ? s.filter((x) => x !== path) : [...s, path]));
    else setSelected((s) => (s.length === 1 && s[0] === path ? [] : [path]));
  };
  const toggle = (path: string) => setSelected((s) => (s.includes(path) ? s.filter((x) => x !== path) : [...s, path]));

  const showAll = () => (setAlbum(null), setStarredOnly(false), setDupView(false));
  const showStarred = () => (setStarredOnly(!starredOnly), setAlbum(null), setDupView(false));
  const showAlbum = (a: string) => (setAlbum(album === a ? null : a), setStarredOnly(false), setDupView(false));
  const showDupes = () => (setDupView(!dupView), setAlbum(null), setStarredOnly(false), setSelected([]));

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
    <StudioShell peek={peek}>
      <div
        className="grid gap-6 @3xl:grid-cols-[220px_minmax(0,1fr)]"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
      >
        {/* Albums & tags */}
        <aside className="min-w-0 space-y-4">
          <Button size="sm" className="@3xl:w-full" onClick={() => fileInput.current?.click()} disabled={!!uploading && !uploading.error} loading={!!uploading && !uploading.error}>
            <UploadIcon /> {t("studio.lib.upload")}
          </Button>
          <input ref={fileInput} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />

          {/* Phone: one scrolling row of chips */}
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] @3xl:hidden">
            <Chip active={!album && !starredOnly && !dupView} onClick={showAll}>
              {t("studio.lib.everything")}
            </Chip>
            <Chip active={starredOnly} onClick={showStarred}>
              <StarIcon className="size-3.5" /> {t("studio.lib.starred")}
            </Chip>
            {(dupCount > 0 || dupView) && (
              <Chip active={dupView} onClick={showDupes}>
                <Copy className="size-3.5" /> {t("studio.lib.duplicates")} {dupCount > 0 && <span className="tabular-nums">{dupCount}</span>}
              </Chip>
            )}
            {albums.map(([a]) => (
              <Chip key={a} active={album === a} onClick={() => showAlbum(a)}>
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
            <SideItem active={!album && !starredOnly && !dupView} onClick={showAll} icon={<LayoutGrid />} label={t("studio.lib.everything")} count={items.length} />
            <SideItem active={starredOnly} onClick={showStarred} icon={<StarIcon />} label={t("studio.lib.starred")} count={starredCount} />
            <SideItem active={dupView} onClick={showDupes} icon={<Copy />} label={t("studio.lib.duplicates")} count={dupes ? dupCount : undefined} />
            <div className="px-2 pt-4 pb-1 text-xs font-medium text-tertiary">{t("studio.lib.albums")}</div>
            {albums.length === 0 && <p className="px-2 text-xs text-tertiary">{t("studio.lib.noAlbums")}</p>}
            {albums.map(([a, n]) => (
              <SideItem key={a} active={album === a} onClick={() => showAlbum(a)} icon={<FolderIcon />} label={a} count={n} />
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
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("studio.lib.search")}
                aria-label={t("studio.lib.search")}
                className="hidden h-7 w-56 text-[13px] @xl:block"
              />
            }
          />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("studio.lib.search")} aria-label={t("studio.lib.search")} className="mt-3 h-8 @xl:hidden" />
          {uploading && (
            <p role="status" className={cn("mt-3 text-xs", uploading.error ? "text-destructive" : "text-muted-foreground")}>
              {uploading.error ?? t("studio.lib.uploading", { n: uploading.done + 1, total: uploading.total })}
            </p>
          )}
          <div
            className={cn(
              "mt-4 rounded-lg outline-2 outline-offset-4 outline-transparent transition-[outline-color] duration-100",
              dragging && "outline-dashed outline-ring",
            )}
          >
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
                {shown.map((i, n) => {
                  const Icon = KIND_ICON[i.kind];
                  const on = selected.includes(i.path);
                  return (
                    <GalleryTile
                      key={i.path}
                      selected={on}
                      onClick={(e) => click(i.path, e)}
                      caption={<span title={i.title || i.name}>{i.title || i.name}</span>}
                      meta={
                        <span className="flex min-w-0 items-center gap-1" title={i.note || undefined}>
                          <Icon className="size-3 shrink-0" />
                          <span className="truncate">{[i.album, ...i.tags.map((tg) => `#${tg}`)].filter(Boolean).join(" · ") || size(i.bytes)}</span>
                        </span>
                      }
                      thumb={<Thumb businessId={businessId} item={i} eager={n < 30} />}
                      topLeft={
                        <span className="flex size-6 items-center justify-center rounded-md bg-background/90 shadow-xs">
                          <Checkbox checked={on} onCheckedChange={() => toggle(i.path)} aria-label={t("studio.lib.select", { name: i.title || i.name })} />
                        </span>
                      }
                      badge={
                        i.starred ? (
                          <span className="flex size-6 items-center justify-center rounded-md bg-background/90 shadow-xs">
                            <StarIcon className="size-3.5 fill-tag-yellow-bg text-warning" />
                          </span>
                        ) : undefined
                      }
                    />
                  );
                })}
              </Gallery>
            )}
          </div>
          {items.length > 0 && <p className="mt-6 text-xs text-tertiary">{t("studio.lib.tip")}</p>}
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
    </StudioShell>
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
      <div className="border-t border-border pt-5">
        <PlanTask businessId={businessId} teammates={teammates} attachments={[item.path]} />
      </div>
    </div>
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
