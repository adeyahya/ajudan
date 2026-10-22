import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Badge, Card } from "@/components/kit";
import { listHumans } from "@/lib/humans";
import { t, type UiLang } from "@/lib/i18n";
import { linkState } from "@/lib/whatsapp";
import { setMyNumber } from "./actions";
import { OwnerNumberForm } from "./owner-form";

/**
 * Shown on the manager page until the owner is a person on the team (ownerHumanId):
 * the three steps to get approvals and team updates on WhatsApp, each with its real
 * state. Step 2 can be done right here.
 */
export async function WhatsappChecklist({ businessId, allowedChats, lang }: { businessId: string; allowedChats: number; lang: UiLang }) {
  await connection();
  const link = await linkState();
  const linked = link.state === "linked";
  const humans = listHumans(businessId);
  const profile = `/b/${businessId}/profile`;
  const team = `/b/${businessId}/team`;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-pixel text-sm">{t(lang, "manager.wa.title")}</h2>
        <span className="text-xs text-muted-foreground">{t(lang, "manager.wa.subtitle")}</span>
      </div>
      <ol className="grid gap-3">
        <Step n={1} done={linked} title={t(lang, "manager.wa.step1")} lang={lang}>
          <p>
            {t(lang, "manager.wa.step1Before")}{" "}
            <Link href={profile} className="underline">
              {t(lang, "manager.wa.businessPage")}
            </Link>
            {t(lang, "manager.wa.step1After")}
          </p>
          {link.state === "qr" || link.state === "starting" ? (
            <p className="text-amber-600 dark:text-amber-400">{t(lang, "manager.wa.linking")}</p>
          ) : null}
        </Step>
        <Step n={2} done={false} title={t(lang, "manager.wa.step2")} lang={lang}>
          <p>{t(lang, "manager.wa.step2Body")}</p>
          {humans.length > 0 && (
            <p>
              {t(lang, "manager.wa.alreadyBefore", { names: humans.map((h) => h.name).join(", ") })}{" "}
              <Link href={team} className="underline">
                {t(lang, "manager.wa.teamPage")}
              </Link>
              {t(lang, "manager.wa.alreadyAfter")}
            </p>
          )}
          <OwnerNumberForm action={setMyNumber.bind(null, businessId)} />
        </Step>
        <Step n={3} done={allowedChats > 0} title={t(lang, "manager.wa.step3")} lang={lang}>
          <p>
            {t(lang, "manager.wa.step3Before")}{" "}
            <Link href={profile} className="underline">
              {t(lang, "manager.wa.businessPage")}
            </Link>
            {t(lang, "manager.wa.step3After")}
          </p>
        </Step>
      </ol>
    </Card>
  );
}

function Step({ n, done, title, lang, children }: { n: number; done: boolean; title: string; lang: UiLang; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
        }`}
        aria-hidden
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          <Badge tone={done ? "green" : "neutral"}>{done ? t(lang, "manager.wa.done") : t(lang, "manager.wa.todo")}</Badge>
        </div>
        <div className="space-y-2 text-muted-foreground [&_b]:text-foreground">{children}</div>
      </div>
    </li>
  );
}
