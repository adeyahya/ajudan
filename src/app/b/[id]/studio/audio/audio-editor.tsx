"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AudioLines, MicIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useT } from "@/components/i18n";
import { Button, EmptyState, IconButton, Input } from "@/components/kit";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Edit } from "@/db/schema";
import { AUDIO_FORMATS, formatTime, type AudioSpec } from "@/lib/edits";
import type { EditorSource } from "@/lib/studio-data";
import { renderEditNow, saveEdit } from "../actions";
import { EditsList, fileUrl, RenderResult } from "../_components/edits-list";
import { localizeError, PropRow } from "@/components/workspace-ui";

const BINS = 900;

/**
 * Audio editor: pick a sound (or a video's sound, or record your voice), trim it on the
 * waveform, set the level and fades, even out loudness, and export into the library.
 */
export function AudioEditor({
  businessId,
  sources,
  edits,
  initialEditId,
  initialFile,
}: {
  businessId: string;
  sources: EditorSource[];
  edits: Edit[];
  initialEditId?: string;
  initialFile?: string;
}) {
  const t = useT();
  const router = useRouter();
  const initial = edits.find((e) => e.id === initialEditId);
  const s0 = initial?.spec as AudioSpec | undefined;
  const firstFile = s0?.file ?? (sources.some((s) => s.path === initialFile) ? initialFile : undefined) ?? sources.find((s) => s.kind === "audio")?.path ?? "";
  const dur0 = sources.find((s) => s.path === firstFile)?.duration ?? 0;

  const [editId, setEditId] = useState(initial?.id);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [file, setFile] = useState(firstFile);
  const [start, setStart] = useState(s0?.start ?? 0);
  const [end, setEnd] = useState(s0?.end ?? dur0);
  const [gainDb, setGainDb] = useState(s0?.gainDb ?? 0);
  const [fadeIn, setFadeIn] = useState(s0?.fadeIn ?? 0);
  const [fadeOut, setFadeOut] = useState(s0?.fadeOut ?? 0);
  const [normalize, setNormalize] = useState(s0?.normalize ?? false);
  const [format, setFormat] = useState<AudioSpec["format"]>(s0?.format ?? "m4a");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start_] = useTransition();

  const source = sources.find((s) => s.path === file);
  const duration = source?.duration ?? 0;
  const current = edits.find((e) => e.id === editId);

  const pick = (p: string) => {
    const s = sources.find((x) => x.path === p);
    setFile(p);
    setStart(0);
    setEnd(s?.duration ?? 0);
  };

  const spec: AudioSpec = { file, start, end, gainDb, fadeIn, fadeOut, normalize, format };
  const save = (thenRender: boolean) =>
    start_(async () => {
      setMsg(null);
      const r = await saveEdit(businessId, { id: editId, kind: "audio", title: title || (source ? `${source.title || source.name.replace(/\.[^.]+$/, "")} (edit)` : ""), spec });
      if ("error" in r) return setMsg({ error: localizeError(t, r.error) });
      setEditId(r.id);
      if (thenRender) {
        const rr = await renderEditNow(businessId, r.id);
        setMsg("error" in rr ? { error: localizeError(t, rr.error) } : { ok: t("studio.audio.exporting") });
      } else setMsg({ ok: t("common.saved") });
      router.replace(`/b/${businessId}/studio/audio?edit=${r.id}`, { scroll: false });
      router.refresh();
    });

  const audioSources = sources.filter((s) => s.kind === "audio");
  const videoSources = sources.filter((s) => s.kind === "video" && s.hasAudio);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[220px_minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1 xl:col-start-2">
        <div className="grid gap-1.5">
          <span className="text-[13px] leading-[18px] text-tertiary">{t("studio.audio.sound")}</span>
          <Select value={file || undefined} onValueChange={pick}>
            <SelectTrigger className="w-full" aria-label={t("studio.audio.sound")}>
              <SelectValue placeholder={t("studio.audio.pickFile")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t("studio.audio.groupAudio")}</SelectLabel>
                {audioSources.map((s) => (
                  <SelectItem key={s.path} value={s.path}>
                    {s.starred ? "★ " : ""}
                    {s.title || s.name} ({formatTime(s.duration)})
                  </SelectItem>
                ))}
              </SelectGroup>
              {videoSources.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t("studio.audio.groupVideo")}</SelectLabel>
                  {videoSources.map((s) => (
                    <SelectItem key={s.path} value={s.path}>
                      {s.title || s.name} ({formatTime(s.duration)})
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
        {file && duration > 0 ? (
          <div className="rounded-lg bg-stage p-4 text-white">
            <Waveform
              key={file}
              url={fileUrl(businessId, file)}
              peaksUrl={`/api/b/${businessId}/peaks?file=${encodeURIComponent(file)}`}
              duration={duration}
              start={start}
              end={end}
              onRange={(s, e) => {
                setStart(s);
                setEnd(e);
              }}
              gainDb={gainDb}
              fadeIn={fadeIn}
              fadeOut={fadeOut}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border">
            <EmptyState
              compact
              icon={<AudioLines />}
              title={t("studio.audio.emptyTitle")}
              body={sources.length ? t("studio.audio.emptyPick") : t("studio.audio.emptyUpload")}
            />
          </div>
        )}
      </div>

      <aside className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1 xl:col-start-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("studio.audio.namePlaceholder")} aria-label={t("studio.audio.name")} className="text-[15px] font-semibold" />
        <div className="space-y-1">
          <PropRow label={t("studio.audio.from")}>
            <Input
              type="number"
              step="0.1"
              min={0}
              value={Number(start.toFixed(2))}
              onChange={(e) => setStart(Math.max(0, Math.min(Number(e.target.value), end - 0.2)))}
              className="h-7 w-24 text-[13px]"
              aria-label={t("studio.audio.from")}
            />
            <span className="text-xs text-tertiary">{t("studio.video.seconds")}</span>
          </PropRow>
          <PropRow label={t("studio.audio.to")}>
            <Input
              type="number"
              step="0.1"
              value={Number(end.toFixed(2))}
              onChange={(e) => setEnd(Math.min(duration, Math.max(Number(e.target.value), start + 0.2)))}
              className="h-7 w-24 text-[13px]"
              aria-label={t("studio.audio.to")}
            />
            <span className="text-xs text-tertiary">{t("studio.video.seconds")}</span>
          </PropRow>
          <PropRow label={t("studio.audio.length")}>
            <span className="text-foreground tabular-nums">{formatTime(Math.max(0, end - start))}</span>
          </PropRow>
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <Slider label={t("studio.audio.level")} value={gainDb} min={-24} max={24} step={1} unit=" dB" onChange={setGainDb} />
          <Slider label={t("studio.audio.fadeIn")} value={fadeIn} min={0} max={10} step={0.5} unit=" s" onChange={setFadeIn} />
          <Slider label={t("studio.audio.fadeOut")} value={fadeOut} min={0} max={10} step={0.5} unit=" s" onChange={setFadeOut} />
        </div>
        <div className="space-y-1 border-t border-border pt-4">
          <label className="flex items-start justify-between gap-3 py-1">
            <span className="min-w-0">
              <span className="block text-[13px] leading-[18px] text-foreground">{t("studio.audio.normalize")}</span>
              <span className="block text-xs text-tertiary">{t("studio.audio.normalizeHint")}</span>
            </span>
            <Switch checked={normalize} onCheckedChange={setNormalize} className="mt-0.5" />
          </label>
          <PropRow label={t("studio.audio.format")}>
            <Select value={format} onValueChange={(v) => setFormat(v as AudioSpec["format"])}>
              <SelectTrigger size="sm" className="w-full" aria-label={t("studio.audio.format")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AUDIO_FORMATS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropRow>
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={pending || !file} onClick={() => save(false)}>
              {t("common.save")}
            </Button>
            <Button size="sm" loading={pending} disabled={pending || !file} onClick={() => save(true)}>
              {pending ? t("common.working") : t("studio.audio.export")}
            </Button>
          </div>
          {msg?.ok && <p className="text-xs text-tertiary">{msg.ok}</p>}
          {msg?.error && (
            <p role="alert" className="text-xs text-destructive">
              {msg.error}
            </p>
          )}
          <RenderResult businessId={businessId} edit={current} />
        </div>
      </aside>

      <aside className="min-w-0 space-y-6 lg:col-span-2 lg:row-start-2 xl:col-span-1 xl:col-start-1 xl:row-start-1">
        <EditsList businessId={businessId} edits={edits} kind="audio" currentId={editId} />
        <Recorder businessId={businessId} onRecorded={(p) => router.push(`/b/${businessId}/studio/audio?file=${encodeURIComponent(p)}`)} />
      </aside>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-[13px] leading-[18px] text-tertiary">
        {label}
        <span className="text-foreground tabular-nums">
          {value > 0 && unit === " dB" ? "+" : ""}
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </label>
  );
}

/** Waveform with a draggable selection; plays the selection with the level and fades applied. */
function Waveform({
  url,
  peaksUrl,
  duration,
  start,
  end,
  onRange,
  gainDb,
  fadeIn,
  fadeOut,
}: {
  url: string;
  peaksUrl: string;
  duration: number;
  start: number;
  end: number;
  onRange: (start: number, end: number) => void;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
}) {
  const tr = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const graph = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(start);

  // Peaks come from ffmpeg on the server (any format, and long videos stay out of the browser).
  useEffect(() => {
    let off = false;
    fetch(`${peaksUrl}&bins=${BINS}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ peaks: number[] }>) : Promise.reject()))
      .then((j) => !off && setPeaks(Float32Array.from(j.peaks)))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [peaksUrl]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    // Colors come from the theme tokens (globals.css): selected bars primary, the rest
    // border-strong, bars that would clip destructive.
    const css = getComputedStyle(c);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const primary = token("--primary", "#2383e2");
    const idle = token("--border-strong", "#d3d1cb");
    const clipping = token("--destructive", "#e03e3e");
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = c.clientHeight * devicePixelRatio);
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    const sx = (start / duration) * w;
    const ex = (end / duration) * w;
    g.globalAlpha = 0.18;
    g.fillStyle = primary;
    g.fillRect(sx, 0, ex - sx, h);
    g.globalAlpha = 1;
    const k = Math.pow(10, gainDb / 20);
    if (peaks) {
      for (let b = 0; b < BINS; b++) {
        const x = (b / BINS) * w;
        const inSel = x >= sx && x <= ex;
        const amp = Math.min(1, peaks[b] * (inSel ? k : 1));
        const bh = Math.max(1, amp * h * 0.9);
        g.globalAlpha = inSel ? 1 : 0.45;
        g.fillStyle = inSel ? (amp >= 0.99 ? clipping : primary) : idle;
        g.fillRect(x, (h - bh) / 2, Math.max(1, w / BINS - 0.5), bh);
      }
      g.globalAlpha = 1;
    }
  }, [peaks, start, end, duration, gainDb]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    // Web Audio lets the preview go louder than 100% and fade like the export will.
    if (!graph.current) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      ctx.createMediaElementSource(a).connect(gain).connect(ctx.destination);
      graph.current = { ctx, gain };
    }
    const { ctx, gain } = graph.current;
    void ctx.resume();
    const from = a.currentTime >= start && a.currentTime < end - 0.05 ? a.currentTime : start;
    a.currentTime = from;
    const level = Math.pow(10, gainDb / 20);
    const now = ctx.currentTime;
    const left = end - from;
    gain.gain.cancelScheduledValues(now);
    const inLeft = Math.max(0, fadeIn - (from - start));
    gain.gain.setValueAtTime(inLeft > 0 ? level * (1 - inLeft / Math.max(fadeIn, 0.001)) : level, now);
    if (inLeft > 0) gain.gain.linearRampToValueAtTime(level, now + inLeft);
    if (fadeOut > 0 && left > fadeOut) {
      gain.gain.setValueAtTime(level, now + left - fadeOut);
      gain.gain.linearRampToValueAtTime(0, now + left);
    }
    void a.play();
    setPlaying(true);
  };

  const onTime = () => {
    const a = audio.current;
    if (!a) return;
    setT(a.currentTime);
    if (playing && a.currentTime >= end) {
      a.pause();
      setPlaying(false);
      a.currentTime = start;
    }
  };

  const onDrag = (e: React.PointerEvent<HTMLElement>) => {
    const which = (e.currentTarget.dataset.which ?? "head") as "start" | "end" | "head";
    const track = e.currentTarget.closest("[data-track]") as HTMLElement;
    const at = (ev: PointerEvent | React.PointerEvent) => {
      const r = track.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * duration * 100) / 100;
    };
    const apply = (x: number) => {
      const a = audio.current;
      if (which === "start") onRange(Math.min(x, end - 0.2), end);
      else if (which === "end") onRange(start, Math.max(x, start + 0.2));
      else if (a) a.currentTime = x;
      setT(x);
    };
    e.preventDefault();
    e.stopPropagation();
    apply(at(e));
    const move = (ev: PointerEvent) => apply(at(ev));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pct = (x: number) => `${(Math.max(0, Math.min(x, duration)) / duration) * 100}%`;
  return (
    <div className="space-y-3">
      <div data-track data-which="head" onPointerDown={onDrag} className="relative h-40 cursor-pointer rounded-md bg-white/5 select-none">
        <canvas ref={canvas} className="absolute inset-0 size-full" />
        {!peaks && <span className="absolute inset-0 flex items-center justify-center text-xs text-white/60">{failed ? tr("studio.audio.waveFailed") : tr("studio.audio.reading")}</span>}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(t) }} />
        <div data-which="start" onPointerDown={onDrag} className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-sm bg-primary" style={{ left: pct(start) }} title={tr("studio.audio.start")} />
        <div data-which="end" onPointerDown={onDrag} className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-sm bg-primary" style={{ left: pct(end) }} title={tr("studio.audio.end")} />
      </div>
      <div className="flex items-center gap-3">
        <IconButton label={playing ? tr("studio.video.pause") : tr("studio.audio.playSelection")} variant="primary" size="icon" onClick={toggle} className="text-white">
          {playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <span className="font-mono text-xs whitespace-nowrap tabular-nums">
          {formatTime(t)} / {formatTime(duration)}
        </span>
        <span className="ml-auto hidden text-xs text-white/60 sm:inline">{tr("studio.audio.trimHint")}</span>
      </div>
      <audio ref={audio} src={url} preload="auto" onTimeUpdate={onTime} onEnded={() => setPlaying(false)} />
    </div>
  );
}

/** Record a voice-over or a voice note with the microphone, straight into the library. */
function Recorder({ businessId, onRecorded }: { businessId: string; onRecorded: (path: string) => void }) {
  const tr = useT();
  const rec = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "recording") return;
    const began = Date.now();
    const t = setInterval(() => setSecs(Math.round((Date.now() - began) / 1000)), 250);
    return () => clearInterval(t);
  }, [state]);

  const startRec = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("saving");
        const blob = new Blob(chunks, { type: r.mimeType });
        const ext = r.mimeType.includes("mp4") ? "m4a" : "weba";
        const name = `voice-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.${ext}`;
        const res = await fetch(`/api/b/${businessId}/media`, { method: "POST", headers: { "X-File-Name": encodeURIComponent(name) }, body: blob });
        const j = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
        setState("idle");
        if (!res.ok || !j.path) return setError(j.error ?? tr("studio.audio.recordFailed"));
        onRecorded(j.path);
      };
      rec.current = r;
      r.start();
      setSecs(0);
      setState("recording");
    } catch {
      setError(tr("studio.audio.noMic"));
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="flex h-7 items-center text-[13px] leading-[18px] font-medium text-tertiary">{tr("studio.audio.record")}</h3>
      <p className="text-xs text-tertiary">{tr("studio.audio.recordHint")}</p>
      {state === "recording" ? (
        <Button size="sm" variant="secondary" onClick={() => rec.current?.stop()} className="w-full text-destructive">
          <SquareIcon className="fill-current" /> {tr("studio.audio.stop", { time: formatTime(secs).replace(/\.\d$/, "") })}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={startRec} loading={state === "saving"} disabled={state === "saving"} className="w-full">
          <MicIcon /> {state === "saving" ? tr("common.saving") : tr("studio.audio.startRecording")}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
