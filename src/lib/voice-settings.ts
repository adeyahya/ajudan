/**
 * Voice-note replies on WhatsApp, per business (Business → WhatsApp → Voice replies),
 * on by default ("mirror": voice back when someone sends a voice note).
 * The voice is made on this Mac by OmniVoice (src/lib/voice.ts): described by its
 * attributes, or cloned from a short clip in the media library. Safe to import from
 * the browser: settings only.
 */

/** off: text only. mirror: a voice note back when the person sent one. always: every message. */
export type VoiceMode = "off" | "mirror" | "always";

export type VoiceSettings = {
  mode: VoiceMode;
  /** OmniVoice voice design, e.g. "female, young adult, moderate pitch". */
  instruct?: string;
  /** A media/… clip (3–10 s, one speaker) to clone instead of a described voice. */
  refAudio?: string;
  /** What the clip says (transcribed when it's picked). */
  refText?: string;
};

export const VOICE_MODES: VoiceMode[] = ["off", "mirror", "always"];

/** OmniVoice's voice-design attributes (one per group), docs/voice-design.md. */
export const VOICE_ATTRS = {
  gender: ["female", "male"],
  age: ["teenager", "young adult", "middle-aged", "elderly"],
  pitch: ["very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch"],
} as const;

export const DEFAULT_INSTRUCT = "female, young adult, moderate pitch";

/** Every business answers voice with voice unless the owner turns it off. */
export const DEFAULT_MODE: VoiceMode = "mirror";

export function voiceSettings(stored: VoiceSettings | null | undefined): Required<Pick<VoiceSettings, "mode" | "instruct">> & VoiceSettings {
  return { ...stored, mode: stored?.mode ?? DEFAULT_MODE, instruct: stored?.instruct?.trim() || DEFAULT_INSTRUCT };
}
