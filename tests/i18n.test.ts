import { describe, expect, it } from "vitest";
import { dateLocale, interpolate, langFromAcceptLanguage, MESSAGES, t, tn, uiLang, type MessageKey } from "@/lib/i18n";
import { autonomyOptions, dayName, describeCron } from "@/lib/onboarding/schedule";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  const enKeys = Object.keys(MESSAGES.en).sort();

  it("every key exists in both languages", () => {
    expect(Object.keys(MESSAGES.id).sort()).toEqual(enKeys);
  });

  it("no translation is empty", () => {
    for (const lang of ["en", "id"] as const) {
      for (const [k, v] of Object.entries(MESSAGES[lang])) expect(v.trim(), `${lang}:${k}`).not.toBe("");
    }
  });

  it("translations keep the same {placeholders}", () => {
    for (const k of enKeys as MessageKey[]) {
      expect(placeholders(MESSAGES.id[k]), k).toEqual(placeholders(MESSAGES.en[k]));
    }
  });

  it("plural keys come in _one/_other pairs", () => {
    for (const k of enKeys) {
      if (k.endsWith("_one")) expect(enKeys, k).toContain(k.replace(/_one$/, "_other"));
    }
  });
});

describe("t()", () => {
  it("interpolates and leaves unknown placeholders alone", () => {
    expect(interpolate("Hi {name}, {n} left", { name: "Sari", n: 3 })).toBe("Hi Sari, 3 left");
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
    expect(t("en", "home.empty", { dir: "~/Ajudan" })).toBe("No businesses yet. Start one below; it will be saved in ~/Ajudan.");
    expect(t("id", "home.empty", { dir: "~/Ajudan" })).toContain("~/Ajudan");
  });

  it("falls back to English for languages without a UI dictionary", () => {
    expect(uiLang("id")).toBe("id");
    expect(uiLang("id-ID")).toBe("id");
    expect(uiLang("ms")).toBe("en");
    expect(uiLang(null)).toBe("en");
    expect(t("ja", "nav.team")).toBe("Team");
    expect(t("id", "nav.team")).toBe("Tim");
    expect(dateLocale("id")).toBe("id-ID");
  });

  it("picks the plural form", () => {
    expect(tn("en", "teammates", 1)).toBe("1 teammate");
    expect(tn("en", "teammates", 0)).toBe("0 teammates");
    expect(tn("en", "teammates", 4)).toBe("4 teammates");
    expect(tn("id", "teammates", 4)).toBe("4 anggota tim");
  });
});

describe("Accept-Language", () => {
  it("picks the best supported language", () => {
    expect(langFromAcceptLanguage("id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("id");
    expect(langFromAcceptLanguage("en-US,en;q=0.9,id;q=0.8")).toBe("en");
    expect(langFromAcceptLanguage("fr-FR,id;q=0.5")).toBe("id");
    expect(langFromAcceptLanguage("en;q=0.2,id;q=0.9")).toBe("id");
    expect(langFromAcceptLanguage("de")).toBe("en");
    expect(langFromAcceptLanguage(null)).toBe("en");
    expect(langFromAcceptLanguage("")).toBe("en");
  });
});

describe("describeCron in Indonesian", () => {
  it("reads naturally", () => {
    expect(describeCron(null, "id")).toBe("Tidak ada kerja rutin");
    expect(describeCron("0 9 * * *", "id")).toBe("Setiap hari jam 09:00");
    expect(describeCron("30 8 * * 1-5", "id")).toBe("Hari kerja (Senin–Jumat) jam 08:30");
    expect(describeCron("0 10 * * 6,0", "id")).toBe("Akhir pekan jam 10:00");
    expect(describeCron("0 9 * * 1", "id")).toBe("Setiap Senin jam 09:00");
    expect(describeCron("45 17 * * 1,3,5", "id")).toBe("Senin, Rabu dan Jumat jam 17:45");
    expect(describeCron("0 */2 * * *", "id")).toBe("0 */2 * * *");
  });

  it("English stays the default", () => {
    expect(describeCron("0 9 * * 1")).toBe("Every Monday at 09:00");
    expect(describeCron("0 9 * * 1", "en")).toBe("Every Monday at 09:00");
    expect(describeCron("0 9 * * 1", "ms")).toBe("Every Monday at 09:00");
  });

  it("day names and autonomy options are localized", () => {
    expect(dayName(0, "id")).toBe("Minggu");
    expect(dayName(5, "id", true)).toBe("Jum");
    expect(dayName(1, "en", true)).toBe("Mon");
    expect(autonomyOptions("id").map((o) => o.value)).toEqual(["draft", "ask", "auto"]);
    expect(autonomyOptions("id")[1].label).toBe("Tanya dulu");
    expect(autonomyOptions().map((o) => o.label)).toEqual(["Draft only", "Ask first", "Autopilot"]);
  });
});
