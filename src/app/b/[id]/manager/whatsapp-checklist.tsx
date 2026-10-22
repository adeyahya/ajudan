import { Check } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Badge } from "@/components/kit";
import { listHumans } from "@/lib/humans";
import { t, type UiLang } from "@/lib/i18n";
import { linkState } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { setMyNumber } from "./actions";
import { OwnerNumberForm } from "./owner-form";

/**
 * The three steps to get approvals and team updates on WhatsApp, each with its real
 * state, shown in the chat home's WhatsApp dialog until the owner is a person on the team
 * (ownerHumanId). Step 2 can be done right here. The dialog carries the title.
 */
export async function WhatsappChecklist({ businessId, allowedChats, lang }: { businessId: string; allowedChats: number; lang: UiLang }) {
  await connection();
  const link = await linkState();
  const linked = link.state === "linked";
  const humans = listHumans(businessId);
  const profile = `/b/${businessId}/profile`;
  const team = `/b/${businessId}/team`;
  const a = "rounded-sm text-foreground underline underline-offset-2 hover:text-primary";

  return (
    <ol className="grid gap-5">
      <Step n={1} done={linked} title={t(lang, "manager.wa.step1")} lang={lang}>
        <p>
          {t(lang, "manager.wa.step1Before")}{" "}
          <Link href={profile} className={a}>
            {t(lang, "manager.wa.businessPage")}
          </Link>
          {t(lang, "manager.wa.step1After")}
        </p>
        {link.state === "qr" || link.state === "starting" ? <p className="text-warning">{t(lang, "manager.wa.linking")}</p> : null}
      </Step>
      <Step n={2} done={false} title={t(lang, "manager.wa.step2")} lang={lang}>
        <p>{t(lang, "manager.wa.step2Body")}</p>
        {humans.length > 0 && (
          <p>
            {t(lang, "manager.wa.alreadyBefore", { names: humans.map((h) => h.name).join(", ") })}{" "}
            <Link href={team} className={a}>
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
          <Link href={profile} className={a}>
            {t(lang, "manager.wa.businessPage")}
          </Link>
          {t(lang, "manager.wa.step3After")}
        </p>
      </Step>
    </ol>
  );
}

function Step({ n, done, title, lang, children }: { n: number; done: boolean; title: string; lang: UiLang; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
      <span
        className={cn(
          "mt-px inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          done ? "bg-success text-white" : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {done ? <Check className="size-3.5" strokeWidth={2.25} /> : n}
      </span>
      <div className="min-w-0 space-y-2 text-sm leading-[22px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{title}</span>
          <Badge tone={done ? "green" : "gray"}>{done ? t(lang, "manager.wa.done") : t(lang, "manager.wa.todo")}</Badge>
        </div>
        <div className="space-y-2 text-[13px] leading-5 text-muted-foreground [&_b]:text-foreground">{children}</div>
      </div>
    </li>
  );
}
