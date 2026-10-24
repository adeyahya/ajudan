import { Search } from "lucide-react";
import Link from "next/link";
import { SetBreadcrumb } from "@/components/breadcrumb";
import { LiveRefresh } from "@/components/live";
import { Badge, cn, PageBody } from "@/components/kit";
import type { ContextPage } from "@/db/schema";
import { describeContact, searchAddressBook } from "@/lib/contacts";
import { pageIcon, pendingSuggestions, readerMode, searchPages, SECTIONS } from "@/lib/context";
import { t, tn, type UiLang } from "@/lib/i18n";
import { Suggestions } from "./context-peek";
import { contextBase, contextHealth, isStale, suggestionView } from "./data";
import { NewMenu, TemplateTile } from "./new-menu";
import { PageIcon } from "./page-icon";

/**
 * Context home (/context without ?page=): what needs the owner (suggestions, pages to
 * check, pages nobody reads, room left in prompts), every section as a card, a search over
 * pages and people (?q=), and templates to start a page from.
 */
export async function ContextHome({ businessId, lang, q }: { businessId: string; lang: UiLang; q: string }) {
  const { pages, rows, mates, mateViews, managerId } = await contextBase(businessId);
  const health = await contextHealth(businessId, mates, { pages, rows });
  const pending = pendingSuggestions(businessId);
  const names = new Map(mates.map((m) => [m.id, m.name]));
  const byId = new Map(pages.map((p) => [p.id, p]));
  const base = `/b/${businessId}/context`;
  const href = (p: ContextPage) => (p.kind === "database" ? `/b/${businessId}/contacts` : `${base}?page=${p.id}`);
  const always = (p: ContextPage) => mates.filter((m) => readerMode(p, m.id, rows) === "always").length;
  const firstStale = health.stale[0];
  const query = q.trim();
  const hits = query ? searchPages(pages.filter((p) => p.kind !== "database"), query, 12) : [];
  const people = query ? searchAddressBook(businessId, query, undefined, 8) : [];

  const cards = [
    {
      label: t(lang, "context.home.waiting"),
      value: tn(lang, "context.home.suggestions", health.pending),
      link: health.pending ? { href: "#waiting", text: t(lang, "context.home.review") } : null,
      tone: health.pending ? "text-primary" : "",
    },
    {
      label: t(lang, "context.home.stale", { days: 60 }),
      value: tn(lang, "context.home.pages", health.stale.length),
      link: firstStale ? { href: `${base}?page=${firstStale.id}`, text: t(lang, "context.home.check") } : null,
      tone: health.stale.length ? "text-warning" : "",
    },
    {
      label: t(lang, "context.home.unread"),
      value: tn(lang, "context.home.pages", health.unread.length),
      link: health.unread.length ? { href: `${base}/readers`, text: t(lang, "context.home.shareOrRemove") } : null,
      tone: "",
    },
  ];

  return (
    <PageBody width="wide" className="sm:pt-12">
      <LiveRefresh businessId={businessId} types={["context_suggested", "context_decided"]} />
      <SetBreadcrumb items={[{ label: t(lang, "context.home.crumb") }]} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-[34px] font-bold tracking-tight sm:text-[32px] sm:leading-10">{t(lang, "context.home.title")}</h1>
          <p className="mt-1.5 max-w-[64ch] text-sm leading-[22px] text-muted-foreground">{t(lang, "context.subtitle")}</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <form action={base} role="search" className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-input px-2.5 focus-within:border-ring sm:w-72 sm:flex-none">
            <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
            <input
              name="q"
              defaultValue={query}
              aria-label={t(lang, "context.home.search")}
              placeholder={t(lang, "context.home.search")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
            />
          </form>
          <NewMenu businessId={businessId} />
        </div>
      </header>

      {query ? (
        <section aria-label={t(lang, "context.home.results")} className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t(lang, "context.home.resultsFor", { q: query })}</h2>
            <Link href={base} className="text-[13px] text-muted-foreground hover:text-foreground">
              {t(lang, "context.home.clear")}
            </Link>
          </div>
          {hits.length || people.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {hits.map((h) => {
                const p = byId.get(h.id);
                return (
                  <li key={h.id}>
                    <Link href={`${base}?page=${h.id}`} className="flex gap-3 px-3 py-2.5 transition-colors duration-100 hover:bg-hover">
                      <PageIcon icon={p ? pageIcon(p) : null} kind={p?.kind} className="mt-0.5 text-tertiary" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{h.title}</span>
                        <span className="line-clamp-2 text-[13px] text-muted-foreground">{h.snippet}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
              {people.map((c) => (
                <li key={c.id}>
                  <Link href={`/b/${businessId}/contacts?c=${c.id}`} className="block px-3 py-2.5 text-[13px] whitespace-pre-line text-muted-foreground transition-colors duration-100 hover:bg-hover">
                    {describeContact(c).replace(/^- /, "")}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t(lang, "context.home.noResults")}</p>
          )}
        </section>
      ) : (
        <>
          <section aria-label={t(lang, "context.home.needsYou")} className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="rounded-lg border border-border px-4 py-3.5">
                <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
                <p className={cn("mt-1.5 text-xl leading-7 font-semibold", c.tone)}>{c.value}</p>
                {c.link ? (
                  <Link href={c.link.href} className="mt-1 inline-block text-[13px] text-primary hover:underline">
                    {c.link.text}
                  </Link>
                ) : (
                  <p className="mt-1 text-[13px] text-tertiary">{t(lang, "context.home.allGood")}</p>
                )}
              </div>
            ))}
            <div className="rounded-lg border border-border px-4 py-3.5">
              <p className="text-xs font-medium text-muted-foreground">{t(lang, "context.home.room")}</p>
              <p className={cn("mt-1.5 text-xl leading-7 font-semibold", health.room < 0.15 && "text-warning")}>{Math.round(health.room * 100)}%</p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={t(lang, "context.home.roomUsed", { pct: Math.round((1 - health.room) * 100) })}>
                <div className={cn("h-full rounded-full", health.room < 0.15 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.round((1 - health.room) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-tertiary">{t(lang, "context.home.roomHelp")}</p>
            </div>
          </section>

          <section aria-label={t(lang, "context.home.sections")} className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {SECTIONS.map((s) => {
              const list = pages.filter((p) => p.section === s);
              const modes = new Set(list.flatMap((p) => mates.map((m) => readerMode(p, m.id, rows))));
              return (
                <div key={s} className="flex flex-col gap-1.5 rounded-lg border border-border p-4">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <h2 className="text-[15px] leading-5 font-semibold">{t(lang, `context.section.${s}`)}</h2>
                    {list.length > 0 && modes.size === 1 && (
                      <span className="text-xs text-tertiary">{t(lang, `context.home.mode.${[...modes][0]}`)}</span>
                    )}
                  </div>
                  {list.length ? (
                    list.map((p) => {
                      const waiting = pending.filter((x) => x.pageId === p.id).length;
                      return (
                        <Link key={p.id} href={href(p)} className="flex min-h-9 items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 transition-colors duration-100 hover:bg-hover-strong">
                          <PageIcon icon={pageIcon(p)} kind={p.kind} className="text-tertiary" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.title}</span>
                          {p.kind === "mindmap" && <Badge tone="purple">{t(lang, "context.mindmap.label")}</Badge>}
                          {waiting > 0 ? (
                            <span className="shrink-0 text-xs text-primary">{tn(lang, "context.home.suggestions", waiting)}</span>
                          ) : isStale(p) ? (
                            <span className="shrink-0 text-xs text-warning">{t(lang, "context.home.notChecked")}</span>
                          ) : p.kind !== "database" ? (
                            <span className="shrink-0 text-xs text-tertiary">{t(lang, "context.home.alwaysCount", { count: always(p), total: mates.length })}</span>
                          ) : null}
                        </Link>
                      );
                    })
                  ) : (
                    <p className="text-[13px] text-tertiary">{t(lang, "context.tree.empty")}</p>
                  )}
                </div>
              );
            })}
            <TemplateTile businessId={businessId} />
          </section>

          {pending.length > 0 && (
            <section id="waiting" aria-label={t(lang, "context.home.waiting")} className="mt-10 max-w-[720px] scroll-mt-16">
              <h2 className="mb-4 text-base font-semibold">{t(lang, "context.home.waiting")}</h2>
              <Suggestions
                businessId={businessId}
                suggestions={pending.map((s) => suggestionView(s, s.pageId ? byId.get(s.pageId) : undefined, names, managerId))}
                mates={mateViews}
                otherPending={[]}
                showPage
              />
            </section>
          )}
        </>
      )}
    </PageBody>
  );
}
