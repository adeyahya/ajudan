import Link from "next/link";
import { Suspense } from "react";
import type { BusinessStatus } from "@/db/schema";
import { Badge, Button, Card, Input, Label, PageHeader, PageSkeleton } from "@/components/kit";
import { listBusinesses } from "@/lib/data";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { createBusiness } from "./actions";
import { LanguageSelect } from "./language-select";

const STATUS: Record<BusinessStatus, { label: string; tone: "amber" | "blue" | "violet" | "green" }> = {
  onboarding: { label: "Interview", tone: "amber" },
  designing: { label: "Designing team", tone: "blue" },
  team_proposed: { label: "Team proposed", tone: "violet" },
  active: { label: "Active", tone: "green" },
};

export default function Home() {
  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <PageHeader title="Your businesses" subtitle="Each business gets its own team of AI teammates." />
      <div className="grid gap-6">
        <Suspense fallback={<PageSkeleton />}>
          <BusinessList />
        </Suspense>
        <Card className="p-5">
          <h2 className="font-medium mb-1">Start a new business</h2>
          <p className="text-sm text-muted-foreground mb-4">
            We&apos;ll look at your website, then interview you for a few minutes to understand the business.
          </p>
          <form action={createBusiness} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor="name">Business name</Label>
              <Input id="name" name="name" required placeholder="Acme Coffee" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" placeholder="https://acme.coffee" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="language">Language</Label>
              <LanguageSelect id="language" defaultValue={DEFAULT_LANGUAGE} />
            </div>
            <Button type="submit">Start interview</Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

async function BusinessList() {
  const list = await listBusinesses();
  if (!list.length) {
    return <p className="text-sm text-muted-foreground">No businesses yet. Start one below.</p>;
  }
  return (
    <Card className="divide-y divide-border">
      {list.map((b) => {
        const s = STATUS[b.status];
        const href = b.status === "onboarding" ? `/b/${b.id}/onboarding` : b.status === "active" ? `/b/${b.id}` : `/b/${b.id}/team`;
        return (
          <Link key={b.id} href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-muted">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{b.name}</div>
              {b.website && <div className="text-xs text-muted-foreground truncate">{b.website}</div>}
            </div>
            <Badge tone={s.tone}>{s.label}</Badge>
          </Link>
        );
      })}
    </Card>
  );
}
