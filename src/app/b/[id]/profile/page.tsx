import { Blocks, Cpu, FolderGit2, Globe, KeyRound, Languages, MessageCircle, MonitorSmartphone, Gauge, ShieldCheck, Store, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Button, EmptyState, LineTabs, PageBody, PageHeader, Prose, PropertyList, Section, Skeleton, ListSkeleton } from "@/components/kit";
import { getBusiness, listTeammates } from "@/lib/data";
import { getSpendRollup } from "@/lib/health";
import { t, uiLang, type UiLang } from "@/lib/i18n";
import { languageName } from "@/lib/language";
import { listLibrary } from "@/lib/assets";
import { backendKey } from "@/lib/secrets";
import { voiceAvailable } from "@/lib/voice";
import { teamEdits } from "@/lib/team-edits";
import { getAgentAccess } from "@/lib/agent-access";
import { goalsToText, joinLines } from "@/lib/onboarding/profile-form";
import { saveProfile } from "./actions";
import { BackendPanel } from "./backend-panel";
import { BrowserPanel } from "./browser-panel";
import { EditProfileDialog } from "./profile-form";
import { AgentAccessPanel } from "./agent-access-panel";
import { PermissionsPanel } from "./permissions-panel";
import { ReposPanel } from "./repos-panel";
import { McpPanel } from "./mcp-panel";
import { listMcpServers, specSecrets } from "@/lib/mcp-servers";
import { SecretsPanel } from "./secrets-panel";
import { SpendPanel } from "./spend-panel";
import { VoicePanel } from "./voice-panel";
import { WhatsappPanel } from "./whatsapp-panel";

/**
 * Business settings, as line tabs (`?tab=`): the profile every teammate reads, what the
 * team may change by itself (permissions), the AI backend that runs it, WhatsApp,
 * the business browser, code repositories, credentials, and usage & language.
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

const TABS = ["profile", "permissions", "backend", "whatsapp", "browser", "repos", "tools", "credentials", "budget"] as const;
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
    { key: "permissions", label: t(lang, "profile.tab.permissions"), icon: <ShieldCheck /> },
    { key: "backend", label: t(lang, "profile.tab.backend"), icon: <Cpu /> },
    { key: "whatsapp", label: "WhatsApp", icon: <MessageCircle /> },
    { key: "browser", label: t(lang, "profile.tab.browser"), icon: <MonitorSmartphone /> },
    { key: "repos", label: t(lang, "profile.tab.repos"), icon: <FolderGit2 /> },
    { key: "tools", label: t(lang, "profile.tab.tools"), icon: <Blocks /> },
    { key: "credentials", label: t(lang, "profile.tab.credentials"), icon: <KeyRound /> },
    { key: "budget", label: t(lang, "profile.tab.budget"), icon: <Gauge /> },
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
        <>
          <WhatsappPanel businessId={id} allowed={biz.whatsappChats} teammatesWithAccess={names((m) => m.whatsappAccess)} lang={lang} />
          <VoicePanel
            key={JSON.stringify(biz.voiceReplies)}
            businessId={id}
            stored={biz.voiceReplies}
            available={voiceAvailable()}
            clips={listLibrary(id)
              .filter((f) => f.kind === "audio")
              .map((f) => ({ path: f.path, label: f.title || f.name }))}
          />
        </>
      )}
      {tab === "permissions" && (
        <>
          <PermissionsPanel businessId={id} edits={teamEdits(biz.teamEdits)} supervised={biz.supervised} />
          <AgentAccessPanel businessId={id} access={getAgentAccess(id)} />
        </>
      )}
      {tab === "backend" && <BackendPanel key={JSON.stringify(biz.aiBackend)} businessId={id} stored={biz.aiBackend} hasKey={Boolean(await backendKey(id))} />}
      {tab === "browser" && <BrowserPanel businessId={id} sites={biz.browserSites} teammatesWithAccess={names((m) => m.browserAccess)} lang={lang} />}
      {tab === "repos" && <ReposPanel businessId={id} teammatesWithAccess={names((m) => m.repoAccess)} lang={lang} />}
      {tab === "tools" && (
        <McpPanel
          businessId={id}
          servers={listMcpServers(id).map((s) => {
            const spec = { name: s.name, transport: s.transport, command: s.command ?? undefined, args: s.args, url: s.url ?? undefined, env: s.env, headers: s.headers };
            return {
              id: s.id,
              name: s.name,
              transport: s.transport,
              where: s.transport === "stdio" ? [s.command, ...s.args].join(" ") : (s.url ?? ""),
              note: s.note,
              secrets: specSecrets(spec),
              trusted: s.trusted,
            };
          })}
          mates={mates.map((m) => ({ id: m.id, name: m.name, access: m.mcpAccess }))}
        />
      )}
      {tab === "credentials" && <SecretsPanel businessId={id} domains={biz.networkDomains} shellMates={names((m) => m.shellAccess)} lang={lang} />}
      {tab === "budget" && <SpendPanel businessId={id} spend={await getSpendRollup(id)} language={biz.language} lang={lang} />}
    </PageBody>
  );
}
