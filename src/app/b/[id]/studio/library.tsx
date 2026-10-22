"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { FileIcon, ImageIcon, MusicIcon, StarIcon, UploadIcon, VideoIcon } from "lucide-react";
import { Badge, Button, Card, cn, Input, Textarea } from "@/components/kit";
import type { LibraryItem } from "@/lib/assets";
import { MEDIA_ACCEPT, type MediaKind } from "@/lib/media-types";
import { deleteAssets, organizeAssets } from "./actions";
import { PlanTask, type MateOption } from "./_components/plan-task";

const KINDS: { key: MediaKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Photos" },
  { key: "video", label: "Videos" },
  { key: "audio", label: "Audio" },
  { key: "file", label: "Other" },
];
const KIND_ICON = { image: ImageIcon, video: VideoIcon, audio: MusicIcon, file: FileIcon };

export const fileUrl = (businessId: string, rel: string) => `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

function size(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** The media library, organized by the owner: albums, tags, notes and stars. */
export function Library({ businessId, items, teammates }: { businessId: string; items: LibraryItem[]; teammates: MateOption[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<MediaKind | "all">("all");
  const [album, setAlbum] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState<{ done: number; total: number; error?: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const albums = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.album) m.set(i.album, (m.get(i.album) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);
  const tags = useMemo(() => [...new Set(items.flatMap((i) => i.tags))].sort(), [items]);

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

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    setUploading({ done: 0, total: list.length });
    const added: string[] = [];
    for (const [n, f] of list.entries()) {
      const res = await fetch(`/api/b/${businessId}/media`, { method: "POST", headers: { "X-File-Name": encodeURIComponent(f.name) }, body: f });
      const j = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !j.path) {
        setUploading({ done: n, total: list.length, error: `${f.name}: ${j.error ?? res.statusText}` });
        router.refresh();
        return;
      }
      added.push(j.path);
      setUploading({ done: n + 1, total: list.length });
    }
    // New uploads land in the album you're looking at.
    if (album) await organizeAssets(businessId, added, { album });
    setUploading(null);
    setSelected(added);
    router.refresh();
  };

  const click = (path: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) setSelected((s) => (s.includes(path) ? s.filter((x) => x !== path) : [...s, path]));
    else setSelected((s) => (s.length === 1 && s[0] === path ? [] : [path]));
  };

  return (
    <div
      className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_20rem]"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
    >
      {/* Albums & tags */}
      <aside className="space-y-3">
        <Button className="w-full" onClick={() => fileInput.current?.click()} disabled={!!uploading && !uploading.error}>
          <UploadIcon /> Upload files
        </Button>
        <input ref={fileInput} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
        {uploading && (
          <p className={cn("text-xs", uploading.error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {uploading.error ?? `Uploading ${uploading.done + 1} of ${uploading.total}…`}
          </p>
        )}
        <Card className="space-y-0.5 p-2 text-sm">
          <SideItem active={!album && !starredOnly} onClick={() => (setAlbum(null), setStarredOnly(false))} label="Everything" count={items.length} />
          <SideItem active={starredOnly} onClick={() => (setStarredOnly(!starredOnly), setAlbum(null))} label="★ Starred" count={items.filter((i) => i.starred).length} />
          <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Albums</div>
          {albums.length === 0 && <p className="px-2 pb-1 text-xs text-muted-foreground">Select files and give them an album.</p>}
          {albums.map(([a, n]) => (
            <SideItem key={a} active={album === a} onClick={() => (setAlbum(album === a ? null : a), setStarredOnly(false))} label={a} count={n} />
          ))}
        </Card>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTag(tag === t ? null : t)}
                className={cn("rounded-full border px-2 py-0.5 text-xs", tag === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Grid */}
      <main className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={cn("font-pixel rounded-md border border-border px-2 py-0.5 text-xs", kind === k.key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}
            >
              {k.label}
            </button>
          ))}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, notes, tags…" className="ml-auto h-8 max-w-60" />
        </div>
        {items.length === 0 ? (
          <Card className={cn("flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground", dragging && "ring-2 ring-primary")}>
            <UploadIcon className="size-8" />
            Drop photos, videos and audio here to start your library.
          </Card>
        ) : shown.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Nothing matches.</Card>
        ) : (
          <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3", dragging && "rounded-md ring-2 ring-primary ring-offset-4 ring-offset-background")}>
            {shown.map((i, n) => {
              const Icon = KIND_ICON[i.kind];
              const on = selected.includes(i.path);
              return (
                <button
                  key={i.path}
                  type="button"
                  onClick={(e) => click(i.path, e)}
                  className={cn("pixel-frame group relative m-[3px] block overflow-hidden bg-muted text-left", on && "outline-3 outline-offset-2 outline-primary")}
                  title={i.title || i.name}
                >
                  <div className="flex aspect-square items-center justify-center">
                    {i.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
                      <img src={fileUrl(businessId, i.path)} alt={i.title || i.name} loading={n < 30 ? "eager" : "lazy"} className="size-full object-cover" />
                    ) : i.kind === "video" ? (
                      <video src={`${fileUrl(businessId, i.path)}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" />
                    ) : (
                      <Icon className="size-10 text-muted-foreground" />
                    )}
                  </div>
                  {i.starred && <StarIcon className="absolute top-1.5 right-1.5 size-4 fill-amber-400 text-amber-500 drop-shadow" />}
                  <div className="flex items-center gap-1 bg-ink/85 px-1.5 py-1 text-[11px] text-parchment">
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate">{i.title || i.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Tip: Ctrl/⌘-click to pick several files. Drop files anywhere here to upload.</p>
      </main>

      {/* Inspector */}
      <aside className="min-w-0">
        {picked.length === 1 ? (
          <Inspector key={picked[0].path} businessId={businessId} item={picked[0]} albums={albums.map((a) => a[0])} teammates={teammates} onGone={() => setSelected([])} />
        ) : picked.length > 1 ? (
          <BulkPanel businessId={businessId} items={picked} albums={albums.map((a) => a[0])} teammates={teammates} onClear={() => setSelected([])} />
        ) : (
          <Card className="space-y-2 p-4 text-sm text-muted-foreground">
            <div className="font-pixel text-base text-foreground">Organize for later</div>
            <p>Pick a file to give it a title, a note on how to use it, tags and an album. Star your best ones.</p>
            <p>When the team is back, they see your stars and notes and use the right files.</p>
          </Card>
        )}
      </aside>
    </div>
  );
}

function SideItem({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted", active && "bg-muted font-medium")}>
      <span className="flex-1 truncate">{label}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

function Inspector({
  businessId,
  item,
  albums,
  teammates,
  onGone,
}: {
  businessId: string;
  item: LibraryItem;
  albums: string[];
  teammates: MateOption[];
  onGone: () => void;
}) {
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
    <Card className="space-y-3 p-3">
      <div className="overflow-hidden bg-muted">
        {item.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
          <img src={url} alt={item.title || item.name} className="max-h-64 w-full object-contain" />
        ) : item.kind === "video" ? (
          <video src={url} controls playsInline className="max-h-64 w-full bg-black" />
        ) : item.kind === "audio" ? (
          <audio src={url} controls className="w-full" />
        ) : (
          <div className="p-6 text-center text-xs text-muted-foreground">No preview</div>
        )}
      </div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={item.path}>
            {item.name}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {size(item.bytes)} · {new Date(item.mtime).toLocaleDateString()}
          </div>
        </div>
        <button
          type="button"
          onClick={() => start(async () => void (await organizeAssets(businessId, [item.path], { starred: !item.starred })))}
          className="rounded p-1 hover:bg-muted"
          title={item.starred ? "Unstar" : "Star: one of your best"}
        >
          <StarIcon className={cn("size-5", item.starred ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
        </button>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onChange={() => setSaved(false)}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Note for the team: what it is, when to use it" />
        <Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="Tags, comma separated" />
        <Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Album" list="studio-albums" />
        <datalist id="studio-albums">
          {albums.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {saved && !dirty && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
        </div>
      </form>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {item.kind === "video" && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/b/${businessId}/studio/video?add=${encodeURIComponent(item.path)}`}>▶ Edit video</Link>
          </Button>
        )}
        {(item.kind === "audio" || item.kind === "video") && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/b/${businessId}/studio/audio?file=${encodeURIComponent(item.path)}`}>♪ Edit audio</Link>
          </Button>
        )}
        <Button asChild size="sm" variant="secondary">
          <a href={`${url}?download=1`}>Download</a>
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (!confirm(`Delete ${item.title || item.name} for good?`)) return;
            start(async () => {
              await deleteAssets(businessId, [item.path]);
              onGone();
            });
          }}
        >
          Delete
        </Button>
      </div>
      <div className="border-t border-border pt-3">
        <PlanTask businessId={businessId} teammates={teammates} attachments={[item.path]} />
      </div>
    </Card>
  );
}

function BulkPanel({
  businessId,
  items,
  albums,
  teammates,
  onClear,
}: {
  businessId: string;
  items: LibraryItem[];
  albums: string[];
  teammates: MateOption[];
  onClear: () => void;
}) {
  const [album, setAlbum] = useState("");
  const [tagText, setTagText] = useState("");
  const [pending, start] = useTransition();
  const paths = items.map((i) => i.path);
  const videos = items.filter((i) => i.kind === "video");
  const allStarred = items.every((i) => i.starred);
  return (
    <Card className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="font-pixel">{items.length} selected</span>
        <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 12).map((i) => (
          <Badge key={i.path}>{(i.title || i.name).slice(0, 18)}</Badge>
        ))}
        {items.length > 12 && <Badge>+{items.length - 12}</Badge>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => void (await organizeAssets(businessId, paths, { album: album || null })));
        }}
      >
        <Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Move to album" list="studio-albums-bulk" className="h-8" />
        <datalist id="studio-albums-bulk">
          {albums.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <Button size="sm" type="submit" disabled={pending}>
          Set
        </Button>
      </form>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            await organizeAssets(businessId, paths, {}, tagText.split(","));
            setTagText("");
          });
        }}
      >
        <Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="Add tags" className="h-8" />
        <Button size="sm" type="submit" disabled={pending || !tagText.trim()}>
          Add
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => void (await organizeAssets(businessId, paths, { starred: !allStarred })))}>
          {allStarred ? "Unstar all" : "★ Star all"}
        </Button>
        {videos.length > 0 && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/b/${businessId}/studio/video?${videos.map((v) => `add=${encodeURIComponent(v.path)}`).join("&")}`}>▶ Edit {videos.length} video{videos.length === 1 ? "" : "s"} together</Link>
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Delete ${items.length} files for good?`)) return;
            start(async () => {
              await deleteAssets(businessId, paths);
              onClear();
            });
          }}
        >
          Delete
        </Button>
      </div>
      <div className="border-t border-border pt-3">
        <PlanTask businessId={businessId} teammates={teammates} attachments={paths} />
      </div>
    </Card>
  );
}
