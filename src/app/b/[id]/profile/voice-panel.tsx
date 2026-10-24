"use client";

import { Mic, Play } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Button, Field, Section } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { VOICE_ATTRS, VOICE_MODES, voiceSettings, type VoiceMode, type VoiceSettings } from "@/lib/voice-settings";
import { ActionForm, SubmitButton } from "../team/action-form";
import { previewVoiceAction, saveVoiceAction } from "./actions";

type Clip = { path: string; label: string };

/**
 * Business → WhatsApp → Voice replies (src/lib/voice-settings.ts): when the team answers
 * with a WhatsApp voice note, and in which voice: described (gender, age, pitch) or
 * cloned from a short clip in the media library. Made on this Mac by OmniVoice
 * (src/lib/voice.ts); the written message is always sent too.
 */
export function VoicePanel({ businessId, stored, available, clips }: { businessId: string; stored: VoiceSettings | null; available: boolean; clips: Clip[] }) {
  const t = useT();
  const s = voiceSettings(stored);
  const [mode, setMode] = useState<VoiceMode>(s.mode);
  const [source, setSource] = useState<"describe" | "clone">(s.refAudio ? "clone" : "describe");
  const [previewing, startPreview] = useTransition();
  const [audioUrl, setAudioUrl] = useState<string>();
  const parts = s.instruct.split(",").map((p) => p.trim());
  const pick = (list: readonly string[], fallback: string) => list.find((v) => parts.includes(v)) ?? fallback;

  return (
    <Section title={t("profile.voice.title")} description={t("profile.voice.help")}>
      {!available && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-[13px] leading-[18px] text-muted-foreground">
          {t("profile.voice.notSetUp")} <code className="rounded bg-background px-1 font-mono text-xs text-foreground">pnpm voice:setup</code>
        </div>
      )}
      <ActionForm action={saveVoiceAction.bind(null, businessId)} success={t("profile.voice.saved")} className="grid max-w-2xl gap-4">
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[13px] leading-[18px] font-medium text-foreground">{t("profile.voice.when")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {VOICE_MODES.map((m) => (
              <label key={m} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-colors", mode === m ? "border-primary bg-primary-soft" : "border-border hover:bg-hover/50")}>
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="accent-primary" />
                  {t(`profile.voice.mode.${m}`)}
                </span>
                <span className="text-xs leading-[16px] text-muted-foreground">{t(`profile.voice.mode.${m}.help`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="mb-1.5 text-[13px] leading-[18px] font-medium text-foreground">{t("profile.voice.voice")}</legend>
          <div className="flex gap-4 text-[13px]">
            {(["describe", "clone"] as const).map((v) => (
              <label key={v} className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="source" value={v} checked={source === v} onChange={() => setSource(v)} className="accent-primary" />
                {t(`profile.voice.source.${v}`)}
              </label>
            ))}
          </div>
          {source === "describe" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(VOICE_ATTRS) as (keyof typeof VOICE_ATTRS)[]).map((k) => (
                <Field key={k} label={t(`profile.voice.attr.${k}`)} htmlFor={`voice-${k}`}>
                  <Select name={k} defaultValue={pick(VOICE_ATTRS[k], k === "gender" ? "female" : k === "age" ? "young adult" : "moderate pitch")}>
                    <SelectTrigger id={`voice-${k}`} size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VOICE_ATTRS[k].map((v) => (
                        <SelectItem key={v} value={v}>
                          {t(`profile.voice.value.${v.replace(/ /g, "_")}` as Parameters<typeof t>[0])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </div>
          ) : (
            <Field label={t("profile.voice.clip")} htmlFor="refAudio" hint={clips.length ? t("profile.voice.clipHelp") : t("profile.voice.noClips")}>
              <Select name="refAudio" defaultValue={s.refAudio ?? clips[0]?.path}>
                <SelectTrigger id="refAudio" size="sm" className="w-full" disabled={!clips.length}>
                  <SelectValue placeholder={t("profile.voice.noClips")} />
                </SelectTrigger>
                <SelectContent>
                  {clips.map((c) => (
                    <SelectItem key={c.path} value={c.path}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </fieldset>

        <p className="text-xs leading-[16px] text-muted-foreground">{t("profile.voice.note")}</p>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton size="sm" variant="secondary">
            {t("common.save")}
          </SubmitButton>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!available}
            loading={previewing}
            onClick={() =>
              startPreview(async () => {
                const r = await previewVoiceAction(businessId);
                if (r.error) toast.error(r.error);
                else setAudioUrl(`${r.url}?t=${Date.now()}`);
              })
            }
          >
            <Play /> {t("profile.voice.preview")}
          </Button>
          {previewing && <span className="text-xs text-muted-foreground">{t("profile.voice.previewWait")}</span>}
        </div>
        {audioUrl && (
          <div className="flex items-center gap-2">
            <Mic className="size-4 text-tertiary" />
            <audio src={audioUrl} controls autoPlay className="h-9 w-full max-w-md" />
          </div>
        )}
      </ActionForm>
    </Section>
  );
}
