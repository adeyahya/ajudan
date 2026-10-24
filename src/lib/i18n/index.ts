import * as common from "./messages/common";
import * as home from "./messages/home";
import * as schedule from "./messages/schedule";
import * as team from "./messages/team";
import * as work from "./messages/work";
import * as business from "./messages/business";
import * as office from "./messages/office";
import * as chat from "./messages/chat";
import * as context from "./messages/context";
import * as studio from "./messages/studio";
import * as desk from "./messages/desk";
import * as workspace from "./messages/workspace";
import * as library from "./messages/library";

/**
 * UI strings (roadmap 5.1). Dependency-free: server components call t(lang, key), client
 * components use useT() from src/components/i18n.tsx. Owner-facing agent text is already
 * written in the business language by the worker; this is only the app's own chrome.
 *
 * Each messages/<area>.ts exports `en` and `id` (typed Record<keyof typeof en, string>,
 * so a missing or extra Indonesian key fails typecheck). Keys are namespaced by area.
 */
export const MESSAGES = {
  en: { ...common.en, ...home.en, ...schedule.en, ...team.en, ...work.en, ...business.en, ...office.en, ...chat.en, ...context.en, ...studio.en, ...desk.en, ...workspace.en, ...library.en },
  id: { ...common.id, ...home.id, ...schedule.id, ...team.id, ...work.id, ...business.id, ...office.id, ...chat.id, ...context.id, ...studio.id, ...desk.id, ...workspace.id, ...library.id },
} satisfies Record<string, Record<string, string>>;

/** Languages the UI is translated into. Other business languages (ms, es, …) get English chrome. */
export type UiLang = keyof typeof MESSAGES;
export type MessageKey = keyof (typeof MESSAGES)["en"];
/** Keys that come as a `<key>_one` / `<key>_other` pair, for tn(). */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer B}_one` ? B : never) : never;
export type Vars = Record<string, string | number>;

export const UI_LANGS = Object.keys(MESSAGES) as UiLang[];

/** A business language code ("id", "en", "ms", …) → the UI language to show. */
export function uiLang(code: string | null | undefined): UiLang {
  const base = String(code ?? "").toLowerCase().split(/[-_]/)[0];
  return (UI_LANGS as string[]).includes(base) ? (base as UiLang) : "en";
}

/** Locale for toLocaleString() and friends. */
export function dateLocale(lang: string | null | undefined) {
  return uiLang(lang) === "id" ? "id-ID" : "en-US";
}

/** "Hello {name}" + { name: "Ana" } → "Hello Ana". Unknown placeholders are left as-is. */
export function interpolate(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Translate a key into the UI language for a business language code. */
export function t(lang: string | null | undefined, key: MessageKey, vars?: Vars): string {
  const l = uiLang(lang);
  return interpolate(MESSAGES[l][key] ?? MESSAGES.en[key] ?? key, vars);
}

/** Count-aware variant: picks `<key>_one` or `<key>_other`; `{count}` is always available. */
export function tn(lang: string | null | undefined, key: PluralKey, count: number, vars?: Vars): string {
  const l = uiLang(lang);
  const form = new Intl.PluralRules(dateLocale(l)).select(count) === "one" ? "one" : "other";
  return t(l, `${key}_${form}` as MessageKey, { count, ...vars });
}

/** Accept-Language header → UI language ("id-ID,id;q=0.9,en;q=0.8" → "id"). Defaults to en. */
export function langFromAcceptLanguage(header: string | null | undefined): UiLang {
  const ranked = String(header ?? "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { base: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.base && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { base } of ranked) if ((UI_LANGS as string[]).includes(base)) return base as UiLang;
  return "en";
}
