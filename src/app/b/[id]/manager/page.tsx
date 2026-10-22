import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, PageSkeleton } from "@/components/kit";
import { formatUsd } from "@/lib/budget";
import { getBusiness, getSpend } from "@/lib/data";
import { t, uiLang } from "@/lib/i18n";
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
  const lang = uiLang(biz.language);
  if (biz.status !== "active") {
    return (
      <Card className="mx-auto max-w-lg p-6">
        <h1 className="mb-1 text-lg text-primary">{t(lang, "manager.notYetTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t(lang, "manager.notYetBody")}</p>
        <Link href={`/b/${id}/${biz.status === "onboarding" ? "onboarding" : "team"}`} className="font-pixel mt-4 inline-block text-primary underline">
          {t(lang, "manager.continue")}
        </Link>
      </Card>
    );
  }
  const manager = ensureManager(id);
  if (!manager) notFound();
  const spend = await getSpend(id);
  return (
    <div className="grid gap-3">
      {!biz.ownerHumanId && (
        // Its own boundary: checking the WhatsApp link shells out to wacli and shouldn't hold up the chat.
        <Suspense fallback={null}>
          <WhatsappChecklist businessId={id} allowedChats={biz.whatsappChats.length} lang={lang} />
        </Suspense>
      )}
      <p className={`text-xs ${spend.over ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
        {t(lang, "manager.spend", { today: formatUsd(spend.today), cap: formatUsd(spend.cap), week: formatUsd(spend.week) })}
        {spend.over && t(lang, "manager.spendOver")}{" "}
        <Link href={`/b/${id}/profile`} className="underline">
          {t(lang, "manager.budgetLink")}
        </Link>
      </p>
      <TeammateView id={id} tid={manager.id} manager />
    </div>
  );
}
