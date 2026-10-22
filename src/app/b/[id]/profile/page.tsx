import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Button, Card, Label, PageHeader, PageSkeleton, Prose } from "@/components/kit";
import { getBusiness, getSpend, listTeammates } from "@/lib/data";
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

function List({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None yet</p>;
  return (
    <ul className="list-disc pl-5 text-sm space-y-0.5">
      {items.map((i, n) => (
        <li key={n}>{i}</li>
      ))}
    </ul>
  );
}

function LanguageForm({ id, language }: { id: string; language: string }) {
  return (
    <form action={saveLanguage.bind(null, id)} className="grid gap-2">
      <Label htmlFor="language">Language</Label>
      <p className="text-xs text-muted-foreground">
        Current: {languageName(language)}. Your interviewer and teammates write everything in this language.
      </p>
      <div className="flex items-center gap-2">
        <LanguageSelect id="language" defaultValue={language} />
        <Button type="submit" variant="secondary">
          Save
        </Button>
      </div>
    </form>
  );
}

async function Content({ params }: Params) {
  const { id } = await params;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const p = biz.profile;
  const mates = await listTeammates(id);
  const spend = await getSpend(id);
  const browserMates = mates.filter((t) => t.browserAccess).map((t) => t.name);
  const shellMates = mates.filter((t) => t.shellAccess).map((t) => t.name);
  const waMates = mates.filter((t) => t.whatsappAccess).map((t) => t.name);
  if (!p) {
    return (
      <Card className="p-6 max-w-xl">
        <h1 className="font-semibold mb-1">No business profile yet</h1>
        <p className="text-sm text-muted-foreground">
          It&apos;s written when you finish the{" "}
          <Link href={`/b/${id}/onboarding`} className="text-primary underline">
            interview
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
          <Section title="Goals (next ~90 days)">
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
              <p className="text-sm text-muted-foreground">None yet</p>
            )}
          </Section>
          <div className="grid gap-5 sm:grid-cols-2">
            <Section title="Products">
              <List items={p.products} />
            </Section>
            <Section title="Target customers">
              <List items={p.targetCustomers} />
            </Section>
            <Section title="Channels">
              <List items={p.channels} />
            </Section>
            <Section title="Competitors">
              <List items={p.competitors} />
            </Section>
            <Section title="Constraints">
              <List items={p.constraints} />
            </Section>
            <Section title="What the team should do">
              <List items={p.teamNeeds} />
            </Section>
          </div>
          <Section title="Brand voice">
            <Prose>{p.brandVoice}</Prose>
          </Section>
        </Card>
        <div className="grid gap-6 content-start">
        <Card className="p-6 grid gap-3">
          <SpendPanel businessId={id} spend={spend} />
          <p className="text-xs text-muted-foreground">
            <Link href={`/b/${id}/health`} className="underline">
              Jobs &amp; health
            </Link>
            : is the worker running, what&apos;s queued, what failed, spend per teammate, last backup.
          </p>
        </Card>
        <Card className="p-6">
          <WhatsappPanel businessId={id} allowed={biz.whatsappChats} teammatesWithAccess={waMates} />
        </Card>
        <Card className="p-6">
          <BrowserPanel businessId={id} sites={biz.browserSites} teammatesWithAccess={browserMates} />
        </Card>
        <Card className="p-6">
          <SecretsPanel businessId={id} domains={biz.networkDomains} shellMates={shellMates} />
        </Card>
        <Card className="p-6 grid gap-6 content-start">
          <LanguageForm id={id} language={biz.language} />
          <details>
            <summary className="cursor-pointer font-medium">Edit profile</summary>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Your teammates read this profile before every task. You can also{" "}
              <Link href={`/b/${id}/onboarding`} className="underline">
                tell the interviewer
              </Link>{" "}
              what changed.
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
