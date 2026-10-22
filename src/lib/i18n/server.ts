import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getDb, schema } from "@/db";
import { isBusinessFolder } from "@/lib/folders";
import { currentDataDir } from "@/lib/paths";
import { langFromAcceptLanguage, uiLang, type UiLang } from "./index";

/**
 * Server-side UI language lookups. Request-time reads: call them inside a <Suspense>
 * boundary (Next.js Cache Components), like the helpers in src/lib/data.ts.
 */

/** The browser's preferred UI language (Accept-Language), en by default. */
export async function requestLang(): Promise<UiLang> {
  const h = await headers();
  return langFromAcceptLanguage(h.get("accept-language"));
}

/** A business's UI language (en when it isn't in the open folder). */
export async function businessLang(businessId: string): Promise<UiLang> {
  await connection();
  const dir = currentDataDir();
  if (!dir || !isBusinessFolder(dir)) return "en";
  const row = getDb(dir)
    .select({ language: schema.businesses.language })
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId))
    .get();
  return uiLang(row?.language);
}

/**
 * UI language outside a business page (home, header): the open business folder's
 * language when one is open, else Accept-Language. The owner already told Ajudan which
 * language they work in, so the business list and header follow it; a fresh install
 * (or the desktop app's Businesses window, which has no folder) follows the browser.
 */
export async function chromeLang(): Promise<UiLang> {
  await connection();
  const dir = currentDataDir();
  if (dir && isBusinessFolder(dir)) {
    try {
      const row = getDb(dir)
        .select({ language: schema.businesses.language })
        .from(schema.businesses)
        .orderBy(asc(schema.businesses.createdAt))
        .get();
      if (row) return uiLang(row.language);
    } catch {
      // Unreadable folder: fall back to the browser's language.
    }
  }
  return requestLang();
}
