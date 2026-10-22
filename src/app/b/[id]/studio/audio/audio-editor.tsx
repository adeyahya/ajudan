"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { MicIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react";
import { Button, Card, cn, Input } from "@/components/kit";
import type { Edit } from "@/db/schema";
import { AUDIO_FORMATS, formatTime, type AudioSpec } from "@/lib/edits";
import type { EditorSource } from "@/lib/studio-data";
import { renderEditNow, saveEdit } from "../actions";
import { EditsList, fileUrl, RenderResult } from "../_components/edits-list";

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
      if ("error" in r) return setMsg({ error: r.error });
      setEditId(r.id);
      if (thenRender) {
        const rr = await renderEditNow(businessId, r.id);
        setMsg("error" in rr ? { error: rr.error } : { ok: "Exporting: the new file lands in your library." });
      } else setMsg({ ok: "Saved" });
      router.replace(`/b/${businessId}/studio/audio?edit=${r.id}`, { scroll: false });
      router.refresh();
    });

  return (
    <div className="grid gap-4 xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
      <aside className="space-y-3">
        <EditsList businessId={businessId} edits={edits} kind="audio" currentId={editId} />
        <Recorder businessId={businessId} onRecorded={(p) => router.push(`/b/${businessId}/studio/audio?file=${encodeURIComponent(p)}`)} />
      </aside>

      <main className="min-w-0 space-y-3">
        <Card className="space-y-2 p-3">
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Sound to edit (audio, or the sound of a video)</span>
            <select value={file} onChange={(e) => pick(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2">
              {!file && <option value="">Pick a file…</option>}
              <optgroup label="Audio">
                {sources
                  .filter((s) => s.kind === "audio")
                  .map((s) => (
                    <option key={s.path} value={s.path}>
                      {s.starred ? "★ " : ""}
                      {s.title || s.name} ({formatTime(s.duration)})
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Sound from a video">
                {sources
                  .filter((s) => s.kind === "video" && s.hasAudio)
                  .map((s) => (
                    <option key={s.path} value={s.path}>
                      {s.title || s.name} ({formatTime(s.duration)})
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
        </Card>
        {file && duration > 0 ? (
          <Card className="space-y-3 bg-[#16101a] p-3 text-parchment">
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
          </Card>
        ) : (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            {sources.length ? "Pick a sound above, or record one on the left." : "Upload audio in Library, or record your voice on the left."}
          </Card>
        )}
      </main>

      <aside className="space-y-3">
        <Card className="space-y-3 p-3 text-sm">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name this sound" />
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">From (s)</span>
              <Input type="number" step="0.1" min={0} value={Number(start.toFixed(2))} onChange={(e) => setStart(Math.max(0, Math.min(Number(e.target.value), end - 0.2)))} className="h-8" />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">To (s)</span>
              <Input type="number" step="0.1" value={Number(end.toFixed(2))} onChange={(e) => setEnd(Math.min(duration, Math.max(Number(e.target.value), start + 0.2)))} className="h-8" />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Length {formatTime(Math.max(0, end - start))}</p>
          <Slider label="Level" value={gainDb} min={-24} max={24} step={1} unit=" dB" onChange={setGainDb} />
          <Slider label="Fade in" value={fadeIn} min={0} max={10} step={0.5} unit=" s" onChange={setFadeIn} />
          <Slider label="Fade out" value={fadeOut} min={0} max={10} step={0.5} unit=" s" onChange={setFadeOut} />
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="mt-1" />
            <span>
              Even out loudness
              <span className="block text-xs text-muted-foreground">Standard level for social media and voice-overs.</span>
            </span>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as AudioSpec["format"])} className="h-8 w-full rounded-md border border-border bg-background px-2">
              {Object.entries(AUDIO_FORMATS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 border-t border-border pt-3">
            <Button variant="secondary" disabled={pending || !file} onClick={() => save(false)}>
              Save
            </Button>
            <Button disabled={pending || !file} onClick={() => save(true)}>
              {pending ? "Working…" : "Export"}
            </Button>
          </div>
          {msg?.ok && <p className="text-xs text-emerald-600 dark:text-emerald-400">{msg.ok}</p>}
          {msg?.error && <p className="text-xs text-red-600 dark:text-red-400">{msg.error}</p>}
          <RenderResult businessId={businessId} edit={current} />
        </Card>
      </aside>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-xs text-muted-foreground">
        {label}
        <span className="text-foreground">
          {value > 0 && unit === " dB" ? "+" : ""}
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
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
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = c.clientHeight * devicePixelRatio);
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    const sx = (start / duration) * w;
    const ex = (end / duration) * w;
    g.fillStyle = "rgba(245,180,60,0.18)";
    g.fillRect(sx, 0, ex - sx, h);
    const k = Math.pow(10, gainDb / 20);
    if (peaks) {
      for (let b = 0; b < BINS; b++) {
        const x = (b / BINS) * w;
        const inSel = x >= sx && x <= ex;
        const amp = Math.min(1, peaks[b] * (inSel ? k : 1));
        const bh = Math.max(1, amp * h * 0.9);
        g.fillStyle = inSel ? (amp >= 0.99 ? "#ef4444" : "#f5b43c") : "#5b4a63";
        g.fillRect(x, (h - bh) / 2, Math.max(1, w / BINS - 0.5), bh);
      }
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
    <div className="space-y-2">
      <div data-track data-which="head" onPointerDown={onDrag} className="relative h-40 cursor-pointer select-none bg-[#221a27]">
        <canvas ref={canvas} className="absolute inset-0 size-full" />
        {!peaks && <span className="absolute inset-0 flex items-center justify-center text-xs opacity-70">{failed ? "Couldn't draw this file's waveform; trimming still works." : "Reading the sound…"}</span>}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(t) }} />
        <div data-which="start" onPointerDown={onDrag} className={cn("absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize bg-primary")} style={{ left: pct(start) }} title="Start" />
        <div data-which="end" onPointerDown={onDrag} className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize bg-primary" style={{ left: pct(end) }} title="End" />
      </div>
      <div className="flex items-center gap-3">
        <Button size="icon" onClick={toggle} aria-label={playing ? "Pause" : "Play the selection"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <span className="font-pixel text-xs">
          {formatTime(t)} / {formatTime(duration)}
        </span>
        <span className="ml-auto text-xs opacity-70">Drag the yellow handles to choose the part to keep. Red bars would clip: lower the level.</span>
      </div>
      <audio ref={audio} src={url} preload="auto" onTimeUpdate={onTime} onEnded={() => setPlaying(false)} />
    </div>
  );
}

/** Record a voice-over or a voice note with the microphone, straight into the library. */
function Recorder({ businessId, onRecorded }: { businessId: string; onRecorded: (path: string) => void }) {
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
        if (!res.ok || !j.path) return setError(j.error ?? "Couldn't save the recording");
        onRecorded(j.path);
      };
      rec.current = r;
      r.start();
      setSecs(0);
      setState("recording");
    } catch {
      setError("No microphone access. Allow the microphone for Ajudan and try again.");
    }
  };

  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="font-pixel">Record</div>
      <p className="text-xs text-muted-foreground">A voice-over, a jingle idea or a note for the team. It goes into your library.</p>
      {state === "recording" ? (
        <Button variant="danger" onClick={() => rec.current?.stop()} className="w-full">
          <SquareIcon /> Stop · {formatTime(secs).replace(/\.\d$/, "")}
        </Button>
      ) : (
        <Button variant="secondary" onClick={startRec} disabled={state === "saving"} className="w-full">
          <MicIcon /> {state === "saving" ? "Saving…" : "Start recording"}
        </Button>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </Card>
  );
}
