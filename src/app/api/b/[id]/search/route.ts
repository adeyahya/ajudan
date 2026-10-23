import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentDataDir } from "@/lib/paths";
import { matchIds } from "@/lib/search";

/**
 * Search for the ⌘K palette (src/components/command-palette.tsx).
 *
 *   GET /api/b/[id]/search?q=gift  →  { results: SearchResult[] }
 *
 * Case-insensitive substring match on Konteks page titles, contacts (name, company),
 * work (title and text, through the search index when the words are long enough,
 * src/lib/search.ts) and teammates (name, title); 8 per group. With an empty `q`
 * it returns the most recently updated pages and work, so the palette has something to show.
 */
export type SearchGroup = "pages" | "people" | "work" | "teammates";
export type SearchResult = { group: SearchGroup; id: string; title: string; subtitle?: string; href: string };

const LIMIT = 8;

export async function GET(req: Request, ctx: RouteContext<"/api/b/[id]/search">) {
  const { id: businessId } = await ctx.params;
  if (!currentDataDir()) return Response.json({ results: [] });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const base = `/b/${businessId}`;
  // LIKE is case-insensitive for ASCII in SQLite; escape the wildcards the user typed.
  const pat = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const match = (col: Parameters<typeof like>[0]) => sql`${col} like ${pat} escape '\\'`;

  const pages = db
    .select({ id: schema.contextPages.id, title: schema.contextPages.title, section: schema.contextPages.section })
    .from(schema.contextPages)
    .where(and(eq(schema.contextPages.businessId, businessId), q ? match(schema.contextPages.title) : undefined))
    .orderBy(desc(sql`coalesce(${schema.contextPages.updatedAt}, ${schema.contextPages.createdAt})`))
    .limit(LIMIT)
    .all();

  const workIds = q ? matchIds("deliverables", businessId, q.split(/\s+/), { all: true }) : null;
  const work = db
    .select({ id: schema.deliverables.id, title: schema.deliverables.title, kind: schema.deliverables.kind })
    .from(schema.deliverables)
    .where(
      and(
        eq(schema.deliverables.businessId, businessId),
        workIds ? inArray(schema.deliverables.id, workIds) : q ? match(schema.deliverables.title) : undefined,
      ),
    )
    .orderBy(desc(schema.deliverables.createdAt))
    .limit(LIMIT)
    .all();

  const people = q
    ? db
        .select({ id: schema.contacts.id, name: schema.contacts.name, company: schema.contacts.company })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.businessId, businessId), or(match(schema.contacts.name), match(schema.contacts.company))))
        .limit(LIMIT)
        .all()
    : [];

  const teammates = q
    ? db
        .select({ id: schema.teammates.id, name: schema.teammates.name, title: schema.teammates.title })
        .from(schema.teammates)
        .where(
          and(
            eq(schema.teammates.businessId, businessId),
            eq(schema.teammates.status, "active"),
            or(match(schema.teammates.name), match(schema.teammates.title)),
          ),
        )
        .limit(LIMIT)
        .all()
    : [];

  const results: SearchResult[] = [
    ...teammates.map((t) => ({ group: "teammates" as const, id: t.id, title: t.name, subtitle: t.title, href: `${base}/teammates/${t.id}` })),
    ...pages.map((p) => ({ group: "pages" as const, id: p.id, title: p.title, href: `${base}/context?page=${p.id}` })),
    ...people.map((c) => ({ group: "people" as const, id: c.id, title: c.name, subtitle: c.company ?? undefined, href: `${base}/context/people?c=${c.id}` })),
    ...work.map((d) => ({ group: "work" as const, id: d.id, title: d.title, subtitle: d.kind.replace(/_/g, " "), href: `${base}/deliverables?d=${d.id}` })),
  ];
  return Response.json({ results });
}
