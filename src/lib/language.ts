/** Primary working language of a business. Every AI teammate writes in it. */
export type Language = { code: string; label: string; nativeLabel: string; style: string };

export const LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English", style: "natural, plain English" },
  { code: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia", style: "natural, conversational Indonesian" },
  { code: "ms", label: "Malay", nativeLabel: "Bahasa Melayu", style: "natural, conversational Malay" },
  { code: "es", label: "Spanish", nativeLabel: "Español", style: "natural, conversational Spanish" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português", style: "natural, conversational Portuguese" },
  { code: "fr", label: "French", nativeLabel: "Français", style: "natural, conversational French" },
  { code: "de", label: "German", nativeLabel: "Deutsch", style: "natural, conversational German" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", style: "natural, polite Japanese" },
] as const satisfies readonly Language[];

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: LanguageCode = "en";

export function getLanguage(code: string | null | undefined): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** Normalize untrusted input (form data) to a supported code. */
export function parseLanguage(raw: unknown): LanguageCode {
  const code = String(raw ?? "");
  return (LANGUAGES.find((l) => l.code === code)?.code ?? DEFAULT_LANGUAGE) as LanguageCode;
}

/** "Bahasa Indonesia" or "English"; native name plus English name when they differ. */
export function languageName(code: string | null | undefined) {
  const l = getLanguage(code);
  return l.nativeLabel === l.label ? l.label : `${l.nativeLabel} (${l.label})`;
}

/** The same strong instruction for every agent's system prompt. */
export function languageInstruction(code: string | null | undefined) {
  const l = getLanguage(code);
  return `## Language
The business's working language is ${l.nativeLabel}. Always write everything in ${l.nativeLabel} (${l.style}): messages to the owner, questions, summaries, profile text, plans, drafts, deliverables, reports, status lines and memory notes. Do this even if the owner, the website, a web page or a teammate uses another language, and regardless of where the brand seems to be from. Keep brand names, product names, people's names, URLs and quoted source text as-is. Structured output keys and enum values stay exactly as specified; only the human-readable text is in ${l.nativeLabel}.`;
}
