import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { OfficeShell } from "./office/office-shell";
import { loadOffice } from "./office/state";

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

  if (business.status === "onboarding") {
    return (
      <StatusCard
        title={`Let's get to know ${business.name}`}
        body="Your team is not hired yet. Finish the onboarding interview so Ajudan can understand the business and design the right teammates."
        href={`/b/${id}/onboarding`}
        cta="Continue the interview"
      />
    );
  }
  if (business.status === "designing" || business.status === "team_proposed") {
    return (
      <StatusCard
        title={business.status === "designing" ? "Your team is being designed" : "Your team proposal is ready"}
        body={
          business.status === "designing"
            ? "Ajudan is putting together a team of AI teammates for your goals. Follow along on the team page."
            : "Review the proposed teammates, adjust them, and hire the team to open the office."
        }
        href={`/b/${id}/team`}
        cta={business.status === "designing" ? "View progress" : "Review the team"}
      />
    );
  }

  const { state, events, now } = await loadOffice(id);
  return (
    <OfficeShell businessId={id} businessName={business.name} initialState={state} initialEvents={events} initialNow={now} />
  );
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
