import { ArrowRight, BellRing, Inbox, Star } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Button, PageBody, PageHeader, PageSkeleton, Section } from "@/components/kit";
import { LiveRefresh } from "@/components/live";
import { ObjectTypeIcon } from "@/components/object-type-icon";
import { actorLabel, typeLabel } from "@/components/workspace-labels";
import { getBusiness, pendingApprovalCount } from "@/lib/data";
import type { HomeItem } from "@/lib/home";
import { t, tn, uiLang, type MessageKey, type UiLang } from "@/lib/i18n";
import { fullTime, relativeTime } from "../deliverables/format";
import { loadHome } from "./data";
import { ReviewQueue, type ReviewItem } from "./review-queue";

/**
 * Home: what's waiting on the owner (approvals, follow-ups due), what the team made since
 * they last looked ("New from the team": keep, open or move to Trash), what they worked on
 * lately, and starred library files (docs/HYBRID-PLAN.md, Phases 0 and 4).
 */
export default function HomePage(props: PageProps<"/b/[id]/home">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/home">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const lang = uiLang(business.language);
  const [home, approvals] = await Promise.all([loadHome(id), pendingApprovalCount(id)]);
  const tr = (key: MessageKey) => t(lang, key);
  const now = home.now;

  const fresh: ReviewItem[] = home.fresh.map((i) => ({
    type: i.type,
    id: i.id,
    title: i.title,
    href: i.href,
    who: actorLabel(tr, i.actor),
    teammateId: i.actor.teammateId,
    color: i.actor.color,
    when: relativeTime(i.at, lang, now),
    whenFull: fullTime(i.at, lang),
  }));

  return (
    <PageBody width="wide">
      {/* Every kind of activity except teammates' tool steps, which come by the hundred during a run. */}
      <LiveRefresh businessId={id} stepsOf="-" />
      <PageHeader title={t(lang, "nav.home")} description={t(lang, "workspace.home.description")} />
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <Section title={t(lang, "workspace.home.newFromTeam")} description={t(lang, "workspace.home.newFromTeamHelp")}>
            <ReviewQueue businessId={id} items={fresh} />
          </Section>
          <Section title={t(lang, "workspace.home.recent")}>
            {home.recent.length ? (
              <ItemList items={home.recent} lang={lang} now={now} />
            ) : (
              <p className="py-2 text-[13px] text-tertiary">{t(lang, "workspace.home.recentEmpty")}</p>
            )}
          </Section>
        </div>

        <aside className="min-w-0">
          <Section title={t(lang, "workspace.home.approvals")}>
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Inbox aria-hidden className="mt-0.5 size-4 shrink-0 text-tertiary" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-[18px] text-foreground">
                  {approvals > 0 ? tn(lang, "workspace.home.approvalsCount", approvals) : t(lang, "workspace.home.approvalsNone")}
                </p>
                {approvals > 0 && (
                  <Button asChild size="sm" variant="secondary" className="mt-2">
                    <Link href={`/b/${id}/approvals`}>
                      {t(lang, "workspace.home.openInbox")}
                      <ArrowRight />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </Section>

          <Section title={t(lang, "workspace.home.followUps")}>
            {home.followUps.length ? (
              <ul className="space-y-0.5">
                {home.followUps.map((c) => {
                  const overdue = !!c.followUpAt && c.followUpAt.getTime() < now;
                  return (
                    <li key={c.id}>
                      <Link href={`/b/${id}/contacts?c=${c.id}`} className="flex min-h-9 items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-hover/60">
                        <BellRing aria-hidden className={overdue ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-tertiary"} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] leading-[18px] font-medium text-foreground">{c.name}</span>
                          <span className="block truncate text-xs text-tertiary">
                            {c.followUpAt && <span title={fullTime(c.followUpAt, lang)}>{relativeTime(c.followUpAt, lang, now)}</span>}
                            {overdue && ` · ${t(lang, "workspace.home.overdue")}`}
                            {c.followUpNote && ` · ${c.followUpNote}`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-1 text-[13px] text-tertiary">{t(lang, "workspace.home.followUpsEmpty")}</p>
            )}
          </Section>

          <Section title={t(lang, "workspace.home.starred")}>
            {home.starred.length ? (
              <ItemList items={home.starred} lang={lang} now={now} icon={<Star aria-hidden className="size-4 shrink-0 fill-current text-yellow-500" />} />
            ) : (
              <p className="py-1 text-[13px] text-tertiary">{t(lang, "workspace.home.starredEmpty")}</p>
            )}
          </Section>
        </aside>
      </div>
    </PageBody>
  );
}

function ItemList({ items, lang, now, icon }: { items: HomeItem[]; lang: UiLang; now: number; icon?: ReactNode }) {
  const tr = (key: MessageKey) => t(lang, key);
  return (
    <ul className="space-y-0.5">
      {items.map((i) => (
        <li key={`${i.type}:${i.id}`}>
          <Link href={i.href} className="flex min-h-9 items-center gap-2.5 rounded-md px-1.5 hover:bg-hover/60">
            {icon ?? <ObjectTypeIcon type={i.type} />}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-foreground">{i.title}</span>
            <span className="shrink-0 text-xs text-tertiary" title={fullTime(i.at, lang)}>
              {typeLabel(tr, i.type)} · {relativeTime(i.at, lang, now)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
