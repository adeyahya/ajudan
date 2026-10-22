import { Globe, KeyRound, Languages, MessageCircle, MonitorSmartphone, PiggyBank, Store, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Button, EmptyState, LineTabs, PageBody, PageHeader, Prose, PropertyList, Section, Skeleton, ListSkeleton } from "@/components/kit";
import { getBusiness, getSpend, listTeammates } from "@/lib/data";
import { t, uiLang, type UiLang } from "@/lib/i18n";
import { languageName } from "@/lib/language";
import { goalsToText, joinLines } from "@/lib/onboarding/profile-form";
import { saveProfile } from "./actions";
import { BrowserPanel } from "./browser-panel";
import { EditProfileDialog } from "./profile-form";
import { SecretsPanel } from "./secrets-panel";
import { SpendPanel } from "./spend-panel";
import { WhatsappPanel } from "./whatsapp-panel";

/**
 * Business settings, as line tabs (`?tab=`): the profile every teammate reads, WhatsApp,
 * the business browser, credentials, and budget & language.
 */
export default function ProfilePage(props: PageProps<"/b/[id]/profile">) {
  return (
    <Suspense
      fallback={
        <PageBody>
          <Skeleton className="h-[34px] w-56 rounded-md" />
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          <Skeleton className="mt-8 h-8 w-full" />
          <ListSkeleton rows={5} className="mt-8" />
        </PageBody>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}

const TABS = ["profile", "whatsapp", "browser", "credentials", "budget"] as const;
type Tab = (typeof TABS)[number];

function List({ items, lang }: { items: string[]; lang: UiLang }) {
  if (!items.length) return <p className="text-sm text-tertiary">{t(lang, "profile.none")}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-[22px] text-foreground marker:text-tertiary">
      {items.map((i, n) => (
        <li key={n}>{i}</li>
      ))}
    </ul>
  );
}

async function Content({ params, searchParams }: PageProps<"/b/[id]/profile">) {
  const { id } = await params;
  const sp = await searchParams;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const lang = uiLang(biz.language);
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "profile";
  const p = biz.profile;
  const mates = (await listTeammates(id)).filter((m) => m.kind !== "human");
  const names = (pick: (m: (typeof mates)[number]) => boolean) => mates.filter(pick).map((m) => m.name);

  const tabs: { key: Tab; label: string; icon: ReactNode }[] = [
    { key: "profile", label: t(lang, "profile.tab.profile"), icon: <Store /> },
    { key: "whatsapp", label: "WhatsApp", icon: <MessageCircle /> },
    { key: "browser", label: t(lang, "profile.tab.browser"), icon: <MonitorSmartphone /> },
    { key: "credentials", label: t(lang, "profile.tab.credentials"), icon: <KeyRound /> },
    { key: "budget", label: t(lang, "profile.tab.budget"), icon: <PiggyBank /> },
  ];

  return (
    <PageBody>
      <PageHeader
        title={p?.name ?? biz.name}
        description={p?.oneLiner || undefined}
        actions={
          tab === "profile" && p ? (
            <EditProfileDialog
              action={saveProfile.bind(null, id)}
              interviewHref={`/b/${id}/onboarding`}
              initial={{
                name: p.name,
                website: p.website ?? "",
                oneLiner: p.oneLiner,
                description: p.description,
                products: joinLines(p.products),
                targetCustomers: joinLines(p.targetCustomers),
                channels: joinLines(p.channels),
                brandVoice: p.brandVoice,
                competitors: joinLines(p.competitors),
                goals: goalsToText(p.goals),
                constraints: joinLines(p.constraints),
                teamNeeds: joinLines(p.teamNeeds),
              }}
            />
          ) : undefined
        }
      />
      <LineTabs
        className="mb-8"
        label={t(lang, "nav.business")}
        items={tabs.map((x) => ({ href: x.key === "profile" ? "?" : `?tab=${x.key}`, label: x.label, icon: x.icon, active: tab === x.key }))}
      />

      {tab === "profile" &&
        (p ? (
          <>
            <PropertyList
              items={[
                {
                  icon: <Globe />,
                  label: t(lang, "profile.form.website"),
                  value: p.website ? (
                    <a href={p.website} target="_blank" rel="noreferrer" className="truncate text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
                      {p.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <span className="text-tertiary">{t(lang, "profile.none")}</span>
                  ),
                },
                { icon: <Languages />, label: t(lang, "profile.language.label"), value: languageName(biz.language) },
                { icon: <UserRound />, label: t(lang, "profile.readBy"), value: t(lang, "profile.readByValue") },
              ]}
            />
            <div className="mt-6 text-[15px] leading-[26px]">
              <Prose>{p.description}</Prose>
            </div>
            <Section title={t(lang, "profile.goals")} className="mt-10">
              {p.goals.length ? (
                <ul className="divide-y divide-border border-y border-border">
                  {p.goals.map((g, i) => (
                    <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
                      <span className="text-sm leading-[22px] font-medium text-foreground">{g.goal}</span>
                      <span className="text-[13px] text-muted-foreground tabular-nums">
                        {g.metric} → {g.target}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-tertiary">{t(lang, "profile.none")}</p>
              )}
            </Section>
            <div className="mt-8 grid gap-x-10 sm:grid-cols-2">
              <Section title={t(lang, "profile.products")}>
                <List items={p.products} lang={lang} />
              </Section>
              <Section title={t(lang, "profile.targetCustomers")} className="sm:mt-0">
                <List items={p.targetCustomers} lang={lang} />
              </Section>
              <Section title={t(lang, "profile.channels")} className="mt-8">
                <List items={p.channels} lang={lang} />
              </Section>
              <Section title={t(lang, "profile.competitors")} className="mt-8">
                <List items={p.competitors} lang={lang} />
              </Section>
              <Section title={t(lang, "profile.constraints")} className="mt-8">
                <List items={p.constraints} lang={lang} />
              </Section>
              <Section title={t(lang, "profile.teamNeeds")} className="mt-8">
                <List items={p.teamNeeds} lang={lang} />
              </Section>
            </div>
            <Section title={t(lang, "profile.brandVoice")}>
              <div className="text-sm leading-[22px]">
                <Prose>{p.brandVoice}</Prose>
              </div>
            </Section>
          </>
        ) : (
          <EmptyState
            icon={<Store />}
            title={t(lang, "profile.noProfileTitle")}
            body={t(lang, "profile.noProfileBody")}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link href={`/b/${id}/onboarding`}>{t(lang, "profile.openInterview")}</Link>
              </Button>
            }
          />
        ))}

      {tab === "whatsapp" && (
        <WhatsappPanel businessId={id} allowed={biz.whatsappChats} teammatesWithAccess={names((m) => m.whatsappAccess)} lang={lang} />
      )}
      {tab === "browser" && <BrowserPanel businessId={id} sites={biz.browserSites} teammatesWithAccess={names((m) => m.browserAccess)} lang={lang} />}
      {tab === "credentials" && <SecretsPanel businessId={id} domains={biz.networkDomains} shellMates={names((m) => m.shellAccess)} lang={lang} />}
      {tab === "budget" && <SpendPanel businessId={id} spend={await getSpend(id)} language={biz.language} lang={lang} />}
    </PageBody>
  );
}
