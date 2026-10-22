import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { t, uiLang } from "@/lib/i18n";
import { ChatHome } from "./_chat/chat-home";

export default function BusinessHomePage(props: PageProps<"/b/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const lang = uiLang(business.language);

  if (business.status === "onboarding") {
    return (
      <StatusCard
        title={t(lang, "bizhome.onboardingTitle", { name: business.name })}
        body={t(lang, "bizhome.onboardingBody")}
        href={`/b/${id}/onboarding`}
        cta={t(lang, "bizhome.onboardingCta")}
      />
    );
  }
  if (business.status === "designing" || business.status === "team_proposed") {
    const step = business.status === "designing" ? (business.busy ? "designing" : "check") : "proposed";
    return (
      <StatusCard
        title={t(lang, `bizhome.${step}Title`)}
        body={t(lang, `bizhome.${step}Body`)}
        href={`/b/${id}/team`}
        cta={t(lang, `bizhome.${step}Cta`)}
      />
    );
  }

  // Hired: home is the conversation with the manager, with the office above it (the full office is /b/[id]/office).
  return <ChatHome business={business} lang={lang} />;
}

function StatusCard({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <Card className="max-w-xl mx-auto mt-10 p-6">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground mt-2">{body}</p>
      <Link
        href={href}
        className="mt-5 inline-flex items-center justify-center rounded-lg px-3.5 h-9 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
      >
        {cta} →
      </Link>
    </Card>
  );
}
