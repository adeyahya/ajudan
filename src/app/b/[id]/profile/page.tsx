import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Button, Card, Label, PageHeader, PageSkeleton, Prose } from "@/components/kit";
import { getBusiness, getSpend, listTeammates } from "@/lib/data";
import { t, uiLang, type UiLang } from "@/lib/i18n";
import { languageName } from "@/lib/language";
import { goalsToText, joinLines } from "@/lib/onboarding/profile-form";
import { LanguageSelect } from "@/app/language-select";
import { saveLanguage, saveProfile } from "./actions";
import { BrowserPanel } from "./browser-panel";
import { SecretsPanel } from "./secrets-panel";
import { SpendPanel } from "./spend-panel";
import { WhatsappPanel } from "./whatsapp-panel";
import { ProfileForm } from "./profile-form";

type Params = { params: Promise<{ id: string }> };

export default function ProfilePage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

function List({ items, lang }: { items: string[]; lang: UiLang }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{t(lang, "profile.none")}</p>;
  return (
    <ul className="list-disc pl-5 text-sm space-y-0.5">
      {items.map((i, n) => (
        <li key={n}>{i}</li>
      ))}
    </ul>
  );
}

function LanguageForm({ id, language }: { id: string; language: string }) {
  const lang = uiLang(language);
  return (
    <form action={saveLanguage.bind(null, id)} className="grid gap-2">
      <Label htmlFor="language">{t(lang, "profile.language.label")}</Label>
      <p className="text-xs text-muted-foreground">
        {t(lang, "profile.language.current", { language: languageName(language) })} {t(lang, "profile.language.help")}
      </p>
      <div className="flex items-center gap-2">
        <LanguageSelect key={language} id="language" defaultValue={language} />
        <Button type="submit" variant="secondary">
          {t(lang, "common.save")}
        </Button>
      </div>
    </form>
  );
}

async function Content({ params }: Params) {
  const { id } = await params;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const lang = uiLang(biz.language);
  const p = biz.profile;
  const mates = await listTeammates(id);
  const spend = await getSpend(id);
  const browserMates = mates.filter((t) => t.browserAccess).map((t) => t.name);
  const shellMates = mates.filter((t) => t.shellAccess).map((t) => t.name);
  const waMates = mates.filter((t) => t.whatsappAccess).map((t) => t.name);
  if (!p) {
    return (
      <Card className="p-6 max-w-xl">
        <h1 className="font-semibold mb-1">{t(lang, "profile.noProfileTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(lang, "profile.noProfileBefore")}{" "}
          <Link href={`/b/${id}/onboarding`} className="text-primary underline">
            {t(lang, "profile.noProfileLink")}
          </Link>
          .
        </p>
        <div className="mt-5">
          <LanguageForm id={id} language={biz.language} />
        </div>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader title={p.name} subtitle={p.oneLiner} />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card className="p-6 grid gap-5 content-start">
          {p.website && (
            <a href={p.website} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
              {p.website}
            </a>
          )}
          <Prose>{p.description}</Prose>
          <Section title={t(lang, "profile.goals")}>
            {p.goals.length ? (
              <div className="grid gap-2">
                {p.goals.map((g, i) => (
                  <div key={i} className="rounded-lg border border-border p-3 text-sm">
                    <div className="font-medium">{g.goal}</div>
                    <div className="text-muted-foreground text-xs mt-0.5">
                      {g.metric} → {g.target}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t(lang, "profile.none")}</p>
            )}
          </Section>
          <div className="grid gap-5 sm:grid-cols-2">
            <Section title={t(lang, "profile.products")}>
              <List items={p.products} lang={lang} />
            </Section>
            <Section title={t(lang, "profile.targetCustomers")}>
              <List items={p.targetCustomers} lang={lang} />
            </Section>
            <Section title={t(lang, "profile.channels")}>
              <List items={p.channels} lang={lang} />
            </Section>
            <Section title={t(lang, "profile.competitors")}>
              <List items={p.competitors} lang={lang} />
            </Section>
            <Section title={t(lang, "profile.constraints")}>
              <List items={p.constraints} lang={lang} />
            </Section>
            <Section title={t(lang, "profile.teamNeeds")}>
              <List items={p.teamNeeds} lang={lang} />
            </Section>
          </div>
          <Section title={t(lang, "profile.brandVoice")}>
            <Prose>{p.brandVoice}</Prose>
          </Section>
        </Card>
        <div className="grid gap-6 content-start">
        <Card className="p-6 grid gap-3">
          <SpendPanel businessId={id} spend={spend} lang={lang} />
          <p className="text-xs text-muted-foreground">
            <Link href={`/b/${id}/health`} className="underline">
              {t(lang, "profile.healthLink")}
            </Link>
            {t(lang, "profile.healthHint")}
          </p>
        </Card>
        <Card className="p-6">
          <WhatsappPanel businessId={id} allowed={biz.whatsappChats} teammatesWithAccess={waMates} lang={lang} />
        </Card>
        <Card className="p-6">
          <BrowserPanel businessId={id} sites={biz.browserSites} teammatesWithAccess={browserMates} lang={lang} />
        </Card>
        <Card className="p-6">
          <SecretsPanel businessId={id} domains={biz.networkDomains} shellMates={shellMates} lang={lang} />
        </Card>
        <Card className="p-6 grid gap-6 content-start">
          <LanguageForm id={id} language={biz.language} />
          <details>
            <summary className="cursor-pointer font-medium">{t(lang, "profile.editProfile")}</summary>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              {t(lang, "profile.editHintBefore")}{" "}
              <Link href={`/b/${id}/onboarding`} className="underline">
                {t(lang, "profile.editHintLink")}
              </Link>{" "}
              {t(lang, "profile.editHintAfter")}
            </p>
            <ProfileForm
              action={saveProfile.bind(null, id)}
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
          </details>
        </Card>
        </div>
      </div>
    </div>
  );
}
