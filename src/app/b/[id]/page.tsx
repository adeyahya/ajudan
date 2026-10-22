import { ArrowRight, PenLine, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Button, EmptyState, PageBody, PageSkeleton } from "@/components/kit";
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
        icon={<PenLine />}
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
        icon={<Users />}
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

function StatusCard({ icon, title, body, href, cta }: { icon: ReactNode; title: string; body: string; href: string; cta: string }) {
  return (
    <PageBody>
      <EmptyState
        icon={icon}
        title={title}
        body={body}
        className="pt-20"
        action={
          <Button size="sm" asChild>
            <Link href={href}>
              {cta}
              <ArrowRight />
            </Link>
          </Button>
        }
      />
    </PageBody>
  );
}
