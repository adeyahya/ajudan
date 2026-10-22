"use client";

import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { t as translate, tn as translateCount, type MessageKey, type PluralKey, type UiLang, type Vars } from "@/lib/i18n";

const LangContext = createContext<UiLang>("en");

/**
 * The UI language for client components below it. The business layout sets it from
 * businesses.language; outside a business (home) the page sets it from Accept-Language.
 * Also mirrors it onto <html lang>, which the root layout can only set statically.
 */
export function I18nProvider({ lang, children }: { lang: UiLang; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** The current UI language (en without a provider). */
export function useLang(): UiLang {
  return useContext(LangContext);
}

/** t() bound to the current UI language: `const t = useT(); t("nav.team")`. */
export function useT() {
  const lang = useContext(LangContext);
  return useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang]);
}

/** Hidden `lang` form field, so a Server Function can answer in the language the form was shown in. */
export function LangField() {
  return <input type="hidden" name="lang" value={useContext(LangContext)} />;
}

/** tn() bound to the current UI language: `tn("teammates", 3)`. */
export function useTn() {
  const lang = useContext(LangContext);
  return useCallback((key: PluralKey, count: number, vars?: Vars) => translateCount(lang, key, count, vars), [lang]);
}
