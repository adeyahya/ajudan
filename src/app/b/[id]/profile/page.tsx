import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Card, PageHeader, PageSkeleton, Prose } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { goalsToText, joinLines } from "@/lib/onboarding/profile-form";
import { saveProfile } from "./actions";
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

async function Content({ params }: Params) {
  const { id } = await params;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const p = biz.profile;
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
        <Card className="p-6 content-start">
          <details>
            <summary className="cursor-pointer font-medium">Edit profile</summary>
            <p className="text-xs text-muted-foreground mt-1 mb-4">Your teammates read this profile before every task.</p>
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
  );
}
