import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { ensureManager } from "@/lib/manager";
import { TeammateView } from "../teammates/[tid]/teammate-view";
import { WhatsappChecklist } from "./whatsapp-checklist";

type Params = { params: Promise<{ id: string }> };

/** The owner's main conversation: the manager, who delegates to the team. */
export default function ManagerPage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: Params) {
  const { id } = await params;
  await connection();
  const biz = await getBusiness(id);
  if (!biz) notFound();
  if (biz.status !== "active") {
    return (
      <Card className="mx-auto max-w-lg p-6">
        <h1 className="mb-1 text-lg text-primary">Your manager arrives with the team</h1>
        <p className="text-sm text-muted-foreground">Finish the interview and hire your team first.</p>
        <Link href={`/b/${id}/${biz.status === "onboarding" ? "onboarding" : "team"}`} className="font-pixel mt-4 inline-block text-primary underline">
          Continue →
        </Link>
      </Card>
    );
  }
  const manager = ensureManager(id);
  if (!manager) notFound();
  return (
    <>
      {!biz.ownerHumanId && (
        // Its own boundary: checking the WhatsApp link shells out to wacli and shouldn't hold up the chat.
        <Suspense fallback={null}>
          <WhatsappChecklist businessId={id} allowedChats={biz.whatsappChats.length} />
        </Suspense>
      )}
      <TeammateView id={id} tid={manager.id} manager />
    </>
  );
}
