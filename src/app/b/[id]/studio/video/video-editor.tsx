"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeftIcon, ChevronRightIcon, Clapperboard, MusicIcon, PauseIcon, PlayIcon, PlusIcon, Search, StarIcon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react";
import { useT, useTn } from "@/components/i18n";
import { Button, cn, EmptyState, IconButton, Input } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Edit } from "@/db/schema";
import type { MessageKey } from "@/lib/i18n";
import { ASPECTS, formatTime, videoLength, type Aspect, type VideoSpec } from "@/lib/edits";
import type { EditorSource } from "@/lib/studio-data";
import { renderEditNow, saveEdit } from "../actions";
import { EditsList, fileUrl, RenderResult } from "../_components/edits-list";
import { localizeError, PropRow, Segmented } from "../_components/studio-shell";

type Clip = VideoSpec["clips"][number] & { key: string };
let nextKey = 0;
const keyed = (c: VideoSpec["clips"][number]): Clip => ({ ...c, key: `c${nextKey++}` });
const NO_MUSIC = "__none";

const ASPECT_LABEL: Record<Aspect, MessageKey> = {
  source: "studio.video.aspect.source",
  "9:16": "studio.video.aspect.9:16",
  "4:5": "studio.video.aspect.4:5",
  "1:1": "studio.video.aspect.1:1",
  "16:9": "studio.video.aspect.16:9",
};

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
  const t = useT();
  const tn = useTn();
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
      if ("error" in r) return setMsg({ error: localizeError(t, r.error) });
      setEditId(r.id);
      if (thenRender) {
        const rr = await renderEditNow(businessId, r.id);
        setMsg("error" in rr ? { error: localizeError(t, rr.error) } : { ok: t("studio.video.rendering") });
      } else setMsg({ ok: t("common.saved") });
      router.replace(`/b/${businessId}/studio/video?edit=${r.id}`, { scroll: false });
      router.refresh();
    });

  const found = videos.filter(match);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[220px_minmax(0,1fr)_280px]">
      {/* Preview + timeline */}
      <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1 xl:col-start-2">
        <div className="flex min-h-[320px] items-center justify-center rounded-lg bg-stage p-4">
          {clips.length ? (
            <Preview businessId={businessId} clips={clips} sel={sel} onSel={setSel} music={music} fit={fit} ratio={ratio} onTrim={(patch) => update(sel, patch)} sourceOf={(p) => byPath.get(p)} />
          ) : (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
              <span aria-hidden className="flex size-14 items-center justify-center rounded-xl bg-white/10 text-white/60">
                <Clapperboard className="size-7" strokeWidth={1.5} />
              </span>
              <p className="max-w-[40ch] text-[13px] leading-[18px] text-white/70">{t("studio.video.emptyStage")}</p>
            </div>
          )}
        </div>

        {clips.length > 0 && (
          <section aria-label={t("studio.video.timeline")}>
            <div className="mb-2 flex items-center justify-between text-xs text-tertiary">
              <span>
                {t("studio.video.timeline")} · {tn("studio.video.clips", clips.length)}
              </span>
              <span className="font-medium text-foreground tabular-nums">{t("studio.video.total", { time: formatTime(total) })}</span>
            </div>
            <div className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1">
              {clips.map((c, i) => {
                const s = byPath.get(c.file);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSel(i)}
                    aria-pressed={i === sel}
                    style={{ flexGrow: Math.max(1, c.end - c.start), minWidth: "5.5rem" }}
                    className={cn(
                      "relative basis-0 overflow-hidden rounded-sm border bg-primary-soft px-2 py-1.5 text-left text-xs transition-colors duration-100",
                      i === sel ? "border-ring ring-1 ring-ring" : "border-ring/40 hover:border-ring/70",
                    )}
                  >
                    <div className="truncate font-medium text-foreground">
                      {i + 1}. {s?.title || s?.name || c.file}
                    </div>
                    <div className="flex items-center gap-1 text-tertiary tabular-nums">
                      {formatTime(c.end - c.start)}
                      {c.muted && <VolumeXIcon className="size-3" />}
                    </div>
                  </button>
                );
              })}
              {music && (
                <div className="flex min-w-24 items-center gap-1 self-stretch rounded-sm border border-dashed border-border-strong px-2 text-xs text-tertiary">
                  <MusicIcon className="size-3" /> {t("studio.video.music")}
                </div>
              )}
            </div>
          </section>
        )}

        {clip && (
          <section aria-label={t("studio.video.clip", { n: sel + 1 })} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-[13px]">
            <span className="font-semibold text-foreground">{t("studio.video.clip", { n: sel + 1 })}</span>
            <label className="flex items-center gap-1.5 text-tertiary">
              {t("studio.video.in")}
              <Input type="number" step="0.1" min={0} value={clip.start} onChange={(e) => update(sel, { start: Math.max(0, Math.min(Number(e.target.value), clip.end - 0.2)) })} className="h-7 w-20 text-[13px]" />
            </label>
            <label className="flex items-center gap-1.5 text-tertiary">
              {t("studio.video.out")}
              <Input
                type="number"
                step="0.1"
                value={clip.end}
                onChange={(e) => update(sel, { end: Math.min(byPath.get(clip.file)?.duration || Infinity, Math.max(Number(e.target.value), clip.start + 0.2)) })}
                className="h-7 w-20 text-[13px]"
              />
            </label>
            <Button size="sm" variant="secondary" onClick={() => update(sel, { muted: !clip.muted })} aria-pressed={!clip.muted}>
              {clip.muted ? <VolumeXIcon /> : <Volume2Icon />} {clip.muted ? t("studio.video.muted") : t("studio.video.soundOn")}
            </Button>
            {!clip.muted && (
              <label className="flex items-center gap-2 text-xs text-tertiary">
                {t("studio.video.volume")}
                <input type="range" min={0} max={2} step={0.05} value={clip.volume} onChange={(e) => update(sel, { volume: Number(e.target.value) })} className="accent-primary" />
                <span className="w-9 text-foreground tabular-nums">{Math.round(clip.volume * 100)}%</span>
              </label>
            )}
            <span className="ml-auto flex gap-1">
              <IconButton label={t("studio.video.moveEarlier")} variant="secondary" onClick={() => move(sel, -1)} disabled={sel === 0}>
                <ChevronLeftIcon />
              </IconButton>
              <IconButton label={t("studio.video.moveLater")} variant="secondary" onClick={() => move(sel, 1)} disabled={sel === clips.length - 1}>
                <ChevronRightIcon />
              </IconButton>
              <IconButton
                label={t("studio.video.removeClip")}
                variant="danger"
                onClick={() => {
                  setClips((cs) => cs.filter((_, j) => j !== sel));
                  setSel((s) => Math.max(0, s - 1));
                }}
              >
                <XIcon />
              </IconButton>
            </span>
          </section>
        )}
      </div>

      {/* Settings + export */}
      <aside className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1 xl:col-start-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("studio.video.namePlaceholder")} aria-label={t("studio.video.name")} className="text-[15px] font-semibold" />
        <div className="space-y-1">
          <PropRow label={t("studio.video.shape")}>
            <Select value={aspect} onValueChange={(v) => setAspect(v as Aspect)}>
              <SelectTrigger size="sm" className="w-full" aria-label={t("studio.video.shape")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ASPECTS) as Aspect[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(ASPECT_LABEL[k])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropRow>
          <PropRow label={t("studio.video.fit")}>
            <Segmented
              label={t("studio.video.fit")}
              value={fit}
              onChange={setFit}
              className="w-full"
              options={[
                { value: "crop", label: t("studio.video.fill") },
                { value: "pad", label: t("studio.video.fitBars") },
              ]}
            />
          </PropRow>
          <PropRow label={t("studio.video.fadeIn")}>
            <Switch checked={fadeIn} onCheckedChange={setFadeIn} aria-label={t("studio.video.fadeIn")} />
            <span className="text-xs text-tertiary">{t("studio.video.fadeInHint")}</span>
          </PropRow>
          <PropRow label={t("studio.video.fadeOut")}>
            <Switch checked={fadeOut} onCheckedChange={setFadeOut} aria-label={t("studio.video.fadeOut")} />
            <span className="text-xs text-tertiary">{t("studio.video.fadeOutHint")}</span>
          </PropRow>
        </div>

        <div className="space-y-1 border-t border-border pt-4">
          <PropRow label={t("studio.video.music")}>
            <Select
              value={music?.file ?? NO_MUSIC}
              onValueChange={(v) => setMusic(v !== NO_MUSIC ? { file: v, start: 0, volume: music?.volume ?? 0.35 } : null)}
            >
              <SelectTrigger size="sm" className="w-full" aria-label={t("studio.video.music")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MUSIC}>{t("common.none")}</SelectItem>
                {audios.map((a) => (
                  <SelectItem key={a.path} value={a.path}>
                    {a.title || a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropRow>
          {music && (
            <>
              <PropRow label={t("studio.video.volume")}>
                <input type="range" min={0} max={1.5} step={0.05} value={music.volume} onChange={(e) => setMusic({ ...music, volume: Number(e.target.value) })} className="min-w-0 flex-1 accent-primary" aria-label={t("studio.video.musicVolume")} />
                <span className="w-9 text-xs text-foreground tabular-nums">{Math.round(music.volume * 100)}%</span>
              </PropRow>
              <PropRow label={t("studio.video.songStart")}>
                <Input type="number" min={0} step={1} value={music.start} onChange={(e) => setMusic({ ...music, start: Math.max(0, Number(e.target.value)) })} className="h-7 w-20 text-[13px]" aria-label={t("studio.video.songStart")} />
                <span className="text-xs text-tertiary">{t("studio.video.seconds")}</span>
              </PropRow>
            </>
          )}
          {audios.length === 0 && <p className="text-xs text-tertiary">{t("studio.video.noMusic")}</p>}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={pending || !clips.length} onClick={() => save(false)}>
              {t("common.save")}
            </Button>
            <Button size="sm" loading={pending} disabled={pending || !clips.length} onClick={() => save(true)}>
              {pending ? t("common.working") : t("studio.video.render")}
            </Button>
          </div>
          {msg?.ok && <p className="text-xs text-tertiary">{msg.ok}</p>}
          {msg?.error && (
            <p role="alert" className="text-xs text-destructive">
              {msg.error}
            </p>
          )}
          <RenderResult businessId={businessId} edit={current} />
          <p className="text-xs text-tertiary">{t("studio.video.renderNote")}</p>
        </div>
      </aside>

      {/* Saved edits + footage */}
      <aside className="min-w-0 space-y-6 lg:col-span-2 lg:row-start-2 xl:col-span-1 xl:col-start-1 xl:row-start-1">
        <EditsList businessId={businessId} edits={edits} kind="video" currentId={editId} />
        <section>
          <h3 className="mb-1 flex h-7 items-center text-[13px] leading-[18px] font-medium text-tertiary">{t("studio.video.footage")}</h3>
          <div className="relative mb-2">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-tertiary" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("studio.video.findFootage")} aria-label={t("studio.video.findFootage")} className="h-7 pl-7 text-[13px]" />
          </div>
          {found.length === 0 ? (
            videos.length === 0 ? (
              <EmptyState compact icon={<Clapperboard />} title={t("studio.video.noFootage")} body={t("studio.video.noFootageBody")} />
            ) : (
              <p className="py-2 text-xs text-tertiary">{t("studio.video.noFootageMatch")}</p>
            )
          ) : (
            <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto">
              {found.map((s) => (
                <li key={s.path}>
                  <button
                    type="button"
                    onClick={() => add(s)}
                    className="group/src flex h-12 w-full items-center gap-2 rounded-md px-1 text-left transition-colors duration-100 hover:bg-hover"
                    title={t("studio.video.addToTimeline")}
                  >
                    <video src={`${fileUrl(businessId, s.path)}#t=0.5`} preload="metadata" muted className="h-10 w-14 shrink-0 rounded-sm bg-stage object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 truncate text-[13px] leading-[18px] text-foreground">
                        {s.starred && <StarIcon aria-label={t("studio.lib.starred")} className="size-3 shrink-0 fill-tag-yellow-bg text-warning" />}
                        <span className="truncate">{s.title || s.name}</span>
                      </span>
                      <span className="text-xs text-tertiary tabular-nums">{formatTime(s.duration)}</span>
                    </span>
                    <PlusIcon className="size-4 shrink-0 text-tertiary opacity-0 transition-opacity group-hover/src:opacity-100 group-focus-visible/src:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
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
  const tr = useT();
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
      <div className="mx-auto max-h-[56vh] overflow-hidden rounded-md bg-black" style={{ aspectRatio: ratio, height: "56vh", maxWidth: "100%" }}>
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
      <div className="flex items-center gap-3 text-white">
        <IconButton label={playing ? tr("studio.video.pause") : tr("studio.video.play")} variant="primary" size="icon" onClick={toggle} className="text-white">
          {playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <span className="font-mono text-xs whitespace-nowrap tabular-nums">
          {formatTime(before + Math.max(0, t - clip.start))} · {tr("studio.video.clipOf", { n: i + 1, total: clips.length })}
        </span>
        <span className="ml-auto hidden text-xs text-white/60 sm:inline">{tr("studio.video.trimHint")}</span>
      </div>
      <div data-track data-which="head" className="relative h-9 cursor-pointer rounded-sm bg-white/10 select-none" onPointerDown={onDrag}>
        <div className="absolute inset-y-0 bg-primary/35" style={{ left: pct(clip.start), width: `calc(${pct(clip.end)} - ${pct(clip.start)})` }} />
        <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(t) }} />
        <div data-which="start" onPointerDown={onDrag} className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-sm bg-primary" style={{ left: pct(clip.start) }} title={tr("studio.video.inPoint")} />
        <div data-which="end" onPointerDown={onDrag} className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-sm bg-primary" style={{ left: pct(clip.end) }} title={tr("studio.video.outPoint")} />
        <span className="pointer-events-none absolute bottom-0.5 left-1.5 text-xs text-white/60 tabular-nums">0:00</span>
        <span className="pointer-events-none absolute right-1.5 bottom-0.5 text-xs text-white/60 tabular-nums">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
