"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeftIcon, ChevronRightIcon, MusicIcon, PauseIcon, PlayIcon, PlusIcon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react";
import { Button, Card, cn, Input } from "@/components/kit";
import type { Edit } from "@/db/schema";
import { ASPECTS, formatTime, videoLength, type Aspect, type VideoSpec } from "@/lib/edits";
import type { EditorSource } from "@/lib/studio-data";
import { renderEditNow, saveEdit } from "../actions";
import { EditsList, fileUrl, RenderResult } from "../_components/edits-list";

type Clip = VideoSpec["clips"][number] & { key: string };
let nextKey = 0;
const keyed = (c: VideoSpec["clips"][number]): Clip => ({ ...c, key: `c${nextKey++}` });

/**
 * A small video editor: line clips up, trim each, pick the frame shape, add music and
 * fades. Preview plays in the browser; the final file is rendered by ffmpeg in the worker.
 */
export function VideoEditor({
  businessId,
  sources,
  edits,
  initialEditId,
  initialAdd,
}: {
  businessId: string;
  sources: EditorSource[];
  edits: Edit[];
  initialEditId?: string;
  initialAdd: string[];
}) {
  const router = useRouter();
  const byPath = useMemo(() => new Map(sources.map((s) => [s.path, s])), [sources]);
  const initial = edits.find((e) => e.id === initialEditId);
  const initialSpec = initial?.spec as VideoSpec | undefined;

  const [editId, setEditId] = useState(initial?.id);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [clips, setClips] = useState<Clip[]>(() =>
    initialSpec
      ? initialSpec.clips.map(keyed)
      : initialAdd
          .map((p) => byPath.get(p))
          .filter((s): s is EditorSource => !!s && s.kind === "video")
          .map((s) => keyed({ file: s.path, start: 0, end: s.duration, muted: false, volume: 1 })),
  );
  const [aspect, setAspect] = useState<Aspect>(initialSpec?.aspect ?? "9:16");
  const [fit, setFit] = useState<VideoSpec["fit"]>(initialSpec?.fit ?? "crop");
  const [fadeIn, setFadeIn] = useState(initialSpec?.fadeIn ?? false);
  const [fadeOut, setFadeOut] = useState(initialSpec?.fadeOut ?? true);
  const [music, setMusic] = useState<VideoSpec["music"]>(initialSpec?.music ?? null);
  const [sel, setSel] = useState(0);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  const current = edits.find((e) => e.id === editId);
  const spec: VideoSpec = { aspect, fit, clips: clips.map((c) => ({ file: c.file, start: c.start, end: c.end, muted: c.muted, volume: c.volume })), music, fadeIn, fadeOut };
  const total = videoLength(spec);
  const clip = clips[Math.min(sel, clips.length - 1)];
  const videos = sources.filter((s) => s.kind === "video");
  const audios = sources.filter((s) => s.kind === "audio");
  const match = (s: EditorSource) => !q.trim() || `${s.title} ${s.name} ${s.album ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());
  const first = clips[0] ? byPath.get(clips[0].file) : undefined;
  const ratio = ASPECTS[aspect].w ? `${ASPECTS[aspect].w} / ${ASPECTS[aspect].h}` : first?.width && first.height ? `${first.width} / ${first.height}` : "9 / 16";

  const update = (i: number, patch: Partial<Clip>) => setClips((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= clips.length) return;
    const next = [...clips];
    [next[i], next[j]] = [next[j], next[i]];
    setClips(next);
    setSel(j);
  };
  const add = (s: EditorSource) => {
    setClips((cs) => [...cs, keyed({ file: s.path, start: 0, end: s.duration, muted: false, volume: 1 })]);
    setSel(clips.length);
  };

  const save = (thenRender: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await saveEdit(businessId, { id: editId, kind: "video", title, spec });
      if ("error" in r) return setMsg({ error: r.error });
      setEditId(r.id);
      if (thenRender) {
        const rr = await renderEditNow(businessId, r.id);
        setMsg("error" in rr ? { error: rr.error } : { ok: "Rendering: the new video lands in your library." });
      } else setMsg({ ok: "Saved" });
      router.replace(`/b/${businessId}/studio/video?edit=${r.id}`, { scroll: false });
      router.refresh();
    });

  return (
    <div className="grid gap-4 xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
      {/* Sources */}
      <aside className="space-y-3">
        <EditsList businessId={businessId} edits={edits} kind="video" currentId={editId} />
        <Card className="space-y-2 p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find footage…" className="h-8" />
          <div className="max-h-[22rem] space-y-1 overflow-y-auto">
            {videos.filter(match).length === 0 && <p className="p-1 text-xs text-muted-foreground">No videos in the library yet. Upload some in Library.</p>}
            {videos.filter(match).map((s) => (
              <button key={s.path} type="button" onClick={() => add(s)} className="flex w-full items-center gap-2 p-1 text-left text-xs hover:bg-muted" title="Add to the timeline">
                <video src={`${fileUrl(businessId, s.path)}#t=0.5`} preload="metadata" muted className="h-10 w-14 shrink-0 bg-black object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{s.starred ? "★ " : ""}{s.title || s.name}</span>
                  <span className="text-muted-foreground">{formatTime(s.duration)}</span>
                </span>
                <PlusIcon className="size-4 shrink-0 text-primary" />
              </button>
            ))}
          </div>
        </Card>
      </aside>

      {/* Preview + timeline */}
      <main className="min-w-0 space-y-3">
        <Card className="flex items-center justify-center bg-[#16101a] p-3">
          {clips.length ? (
            <Preview businessId={businessId} clips={clips} sel={sel} onSel={setSel} music={music} fit={fit} ratio={ratio} onTrim={(patch) => update(sel, patch)} sourceOf={(p) => byPath.get(p)} />
          ) : (
            <p className="p-16 text-center text-sm text-parchment/70">Add footage from the left to start. Clips play one after another.</p>
          )}
        </Card>

        {clips.length > 0 && (
          <Card className="space-y-2 p-2">
            <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
              <span>Timeline · {clips.length} clip{clips.length === 1 ? "" : "s"}</span>
              <span className="font-pixel text-sm text-foreground">Total {formatTime(total)}</span>
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {clips.map((c, i) => {
                const s = byPath.get(c.file);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSel(i)}
                    style={{ flexGrow: Math.max(1, c.end - c.start), minWidth: "5.5rem" }}
                    className={cn("relative basis-0 overflow-hidden border-2 bg-secondary p-1.5 text-left text-xs", i === sel ? "border-primary" : "border-frame")}
                  >
                    <div className="truncate font-medium">
                      {i + 1}. {s?.title || s?.name || c.file}
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      {formatTime(c.end - c.start)}
                      {c.muted && <VolumeXIcon className="size-3" />}
                    </div>
                  </button>
                );
              })}
              {music && (
                <div className="flex min-w-24 items-center gap-1 self-stretch border-2 border-dashed border-frame px-2 text-xs text-muted-foreground">
                  <MusicIcon className="size-3" /> music
                </div>
              )}
            </div>
          </Card>
        )}

        {clip && (
          <Card className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="font-pixel">Clip {sel + 1}</span>
            <label className="flex items-center gap-1">
              In
              <Input type="number" step="0.1" min={0} value={clip.start} onChange={(e) => update(sel, { start: Math.max(0, Math.min(Number(e.target.value), clip.end - 0.2)) })} className="h-8 w-20" />
            </label>
            <label className="flex items-center gap-1">
              Out
              <Input
                type="number"
                step="0.1"
                value={clip.end}
                onChange={(e) => update(sel, { end: Math.min(byPath.get(clip.file)?.duration || Infinity, Math.max(Number(e.target.value), clip.start + 0.2)) })}
                className="h-8 w-20"
              />
            </label>
            <Button size="sm" variant="secondary" onClick={() => update(sel, { muted: !clip.muted })}>
              {clip.muted ? <VolumeXIcon /> : <Volume2Icon />} {clip.muted ? "Muted" : "Sound on"}
            </Button>
            {!clip.muted && (
              <label className="flex items-center gap-2 text-xs">
                Volume
                <input type="range" min={0} max={2} step={0.05} value={clip.volume} onChange={(e) => update(sel, { volume: Number(e.target.value) })} />
                {Math.round(clip.volume * 100)}%
              </label>
            )}
            <span className="ml-auto flex gap-1">
              <Button size="icon-sm" variant="secondary" onClick={() => move(sel, -1)} disabled={sel === 0} aria-label="Move earlier">
                <ChevronLeftIcon />
              </Button>
              <Button size="icon-sm" variant="secondary" onClick={() => move(sel, 1)} disabled={sel === clips.length - 1} aria-label="Move later">
                <ChevronRightIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="danger"
                onClick={() => {
                  setClips((cs) => cs.filter((_, j) => j !== sel));
                  setSel((s) => Math.max(0, s - 1));
                }}
                aria-label="Remove clip"
              >
                <XIcon />
              </Button>
            </span>
          </Card>
        )}
      </main>

      {/* Settings + export */}
      <aside className="space-y-3">
        <Card className="space-y-3 p-3 text-sm">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name this video" />
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Shape</span>
            <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)} className="h-8 w-full rounded-md border border-border bg-background px-2">
              {Object.entries(ASPECTS).map(([k, a]) => (
                <option key={k} value={k}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 text-xs">
            {(["crop", "pad"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFit(f)} className={cn("flex-1 border-2 px-2 py-1", fit === f ? "border-primary bg-primary/15" : "border-frame")}>
                {f === "crop" ? "Fill (crop edges)" : "Fit (black bars)"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={fadeIn} onChange={(e) => setFadeIn(e.target.checked)} /> Fade in from black
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={fadeOut} onChange={(e) => setFadeOut(e.target.checked)} /> Fade out at the end
          </label>
          <div className="space-y-1 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">Background music</span>
            <select
              value={music?.file ?? ""}
              onChange={(e) => setMusic(e.target.value ? { file: e.target.value, start: 0, volume: music?.volume ?? 0.35 } : null)}
              className="h-8 w-full rounded-md border border-border bg-background px-2"
            >
              <option value="">None</option>
              {audios.map((a) => (
                <option key={a.path} value={a.path}>
                  {a.title || a.name}
                </option>
              ))}
            </select>
            {music && (
              <>
                <label className="flex items-center gap-2 text-xs">
                  Volume
                  <input type="range" min={0} max={1.5} step={0.05} value={music.volume} onChange={(e) => setMusic({ ...music, volume: Number(e.target.value) })} className="flex-1" />
                  {Math.round(music.volume * 100)}%
                </label>
                <label className="flex items-center gap-2 text-xs">
                  Start the song at
                  <Input type="number" min={0} step={1} value={music.start} onChange={(e) => setMusic({ ...music, start: Math.max(0, Number(e.target.value)) })} className="h-7 w-20" />s
                </label>
              </>
            )}
            {audios.length === 0 && <p className="text-xs text-muted-foreground">Upload music in Library to use it here.</p>}
          </div>
          <div className="flex gap-2 border-t border-border pt-3">
            <Button variant="secondary" disabled={pending || !clips.length} onClick={() => save(false)}>
              Save
            </Button>
            <Button disabled={pending || !clips.length} onClick={() => save(true)}>
              {pending ? "Working…" : "Render video"}
            </Button>
          </div>
          {msg?.ok && <p className="text-xs text-emerald-600 dark:text-emerald-400">{msg.ok}</p>}
          {msg?.error && <p className="text-xs text-red-600 dark:text-red-400">{msg.error}</p>}
          <RenderResult businessId={businessId} edit={current} />
        </Card>
        <p className="px-1 text-xs text-muted-foreground">Renders run on this Mac with ffmpeg and use no Claude usage. The team can polish it further (titles, captions) when they&apos;re back.</p>
      </aside>
    </div>
  );
}

/**
 * Plays the timeline in order (clip by clip) with the music, framed like the export.
 * Below it, a trim bar for the selected clip.
 */
function Preview({
  businessId,
  clips,
  sel,
  onSel,
  music,
  fit,
  ratio,
  onTrim,
  sourceOf,
}: {
  businessId: string;
  clips: Clip[];
  sel: number;
  onSel: (i: number) => void;
  music: VideoSpec["music"];
  fit: VideoSpec["fit"];
  ratio: string;
  onTrim: (patch: Partial<Clip>) => void;
  sourceOf: (p: string) => EditorSource | undefined;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const i = Math.min(sel, clips.length - 1);
  const clip = clips[i];
  const duration = sourceOf(clip.file)?.duration || clip.end;
  const before = clips.slice(0, i).reduce((s, c) => s + (c.end - c.start), 0);

  // Show the selected clip at its in-point (and keep playing across clips).
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = clip.muted;
    v.volume = Math.min(1, clip.volume);
    const seek = () => {
      v.currentTime = clip.start;
      if (playing) void v.play().catch(() => {});
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seek only when the clip changes
  }, [clip.key, clip.file]);

  useEffect(() => {
    const v = video.current;
    if (v) {
      v.muted = clip.muted;
      v.volume = Math.min(1, clip.volume);
    }
  }, [clip.muted, clip.volume]);

  const syncMusic = (at: number, play: boolean) => {
    const a = audio.current;
    if (!a || !music) return;
    a.volume = Math.min(1, music.volume);
    a.currentTime = music.start + at;
    if (play) void a.play().catch(() => {});
    else a.pause();
  };

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (playing) {
      v.pause();
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    if (v.currentTime < clip.start || v.currentTime >= clip.end - 0.05) v.currentTime = clip.start;
    void v.play().catch(() => {});
    syncMusic(before + (v.currentTime - clip.start), true);
    setPlaying(true);
  };

  const onTime = () => {
    const v = video.current;
    if (!v) return;
    setT(v.currentTime);
    if (!playing || v.currentTime < clip.end - 0.04) return;
    if (i < clips.length - 1) onSel(i + 1);
    else {
      v.pause();
      audio.current?.pause();
      setPlaying(false);
      onSel(0);
    }
  };

  const pct = (x: number) => `${(Math.max(0, Math.min(x, duration)) / duration) * 100}%`;
  const onDrag = (e: React.PointerEvent<HTMLElement>) => {
    const which = (e.currentTarget.dataset.which ?? "head") as "start" | "end" | "head";
    const track = e.currentTarget.closest("[data-track]") as HTMLElement;
    const at = (ev: PointerEvent | React.PointerEvent) => {
      const r = track.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * duration * 10) / 10;
    };
    const apply = (x: number) => {
      if (which === "start") onTrim({ start: Math.min(x, clip.end - 0.2) });
      else if (which === "end") onTrim({ end: Math.max(x, clip.start + 0.2) });
      if (video.current) video.current.currentTime = which === "head" ? x : which === "start" ? Math.min(x, clip.end - 0.2) : Math.max(x, clip.start + 0.2);
    };
    e.preventDefault();
    e.stopPropagation();
    apply(at(e));
    const moveFn = (ev: PointerEvent) => apply(at(ev));
    const up = () => {
      window.removeEventListener("pointermove", moveFn);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", moveFn);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="w-full space-y-3">
      <div className="mx-auto max-h-[56vh] overflow-hidden bg-black" style={{ aspectRatio: ratio, height: "56vh", maxWidth: "100%" }}>
        <video
          ref={video}
          src={fileUrl(businessId, clip.file)}
          playsInline
          preload="auto"
          onTimeUpdate={onTime}
          onClick={toggle}
          className={cn("size-full", fit === "crop" ? "object-cover" : "object-contain")}
        />
        {music && <audio ref={audio} src={fileUrl(businessId, music.file)} preload="auto" loop />}
      </div>
      <div className="flex items-center gap-3 text-parchment">
        <Button size="icon" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <span className="font-pixel text-xs">
          {formatTime(before + Math.max(0, t - clip.start))} · clip {i + 1}/{clips.length}
        </span>
        <span className="ml-auto text-xs opacity-70">Drag the yellow handles to trim this clip</span>
      </div>
      <div data-track data-which="head" className="relative h-9 cursor-pointer select-none bg-[#2a1f30]" onPointerDown={onDrag}>
        <div className="absolute inset-y-0 bg-primary/35" style={{ left: pct(clip.start), width: `calc(${pct(clip.end)} - ${pct(clip.start)})` }} />
        <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(t) }} />
        <div data-which="start" onPointerDown={onDrag} className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize bg-primary" style={{ left: pct(clip.start) }} title="In point" />
        <div data-which="end" onPointerDown={onDrag} className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize bg-primary" style={{ left: pct(clip.end) }} title="Out point" />
        <span className="pointer-events-none absolute bottom-0.5 left-1 text-[10px] text-parchment/70">0:00</span>
        <span className="pointer-events-none absolute right-1 bottom-0.5 text-[10px] text-parchment/70">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
