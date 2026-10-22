import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Business } from "@/db/schema";
import { t, type UiLang } from "@/lib/i18n";
import { ensureManager } from "@/lib/manager";
import { WhatsappChecklist } from "../manager/whatsapp-checklist";
import { loadOffice } from "../office/state";
import { TeammateView } from "../teammates/[tid]/teammate-view";
import { ConversationChips, ConversationList } from "./conversation-list";
import { loadConversations } from "./data";
import { LevelUps, type LevelUpCard } from "./level-ups";
import { OfficeStrip } from "./office-strip";

/**
 * The business home once the team is hired (G1, chat-first): conversations on the left,
 * the living office as a strip on top, and the owner's conversation with the manager
 * under it. Everything the team does comes to the owner here.
 */
export async function ChatHome({ business, lang }: { business: Business; lang: UiLang }) {
  const id = business.id;
  const manager = ensureManager(id);
  if (!manager) notFound();
  const [data, office] = await Promise.all([loadConversations(id, lang), loadOffice(id)]);
  const mates = new Map(data.teammates.map((m) => [m.id, m]));
  const ups: LevelUpCard[] = data.progress.levelUps.flatMap((u) => {
    const m = u.teammateId ? mates.get(u.teammateId) : undefined;
    if (u.teammateId && !m) return [];
    return [{ key: `${u.teammateId ?? "team"}-${u.level}`, at: u.at, level: u.level, mate: m ? { id: m.id, name: m.name, color: m.color } : undefined }];
  });

  return (
    <div className="grid h-[calc(100dvh-var(--chrome-h))] min-h-[28rem] gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ConversationList data={data} activeId={manager.id} className="hidden lg:flex" />
      <div className="flex min-h-0 min-w-0 flex-col gap-2">
        <ConversationChips data={data} activeId={manager.id} className="lg:hidden" />
        <OfficeStrip businessId={id} businessName={business.name} initialState={office.state} initialNow={office.now} />
        {!business.ownerHumanId && (
          <details className="group shrink-0 rounded-md border border-secondary text-sm">
            <summary className="font-pixel cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <span aria-hidden className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>
              {t(lang, "manager.wa.title")}
            </summary>
            <div className="max-h-[45vh] overflow-y-auto px-1">
              {/* Its own boundary: checking the WhatsApp link shells out to wacli and shouldn't hold up the chat. */}
              <Suspense fallback={null}>
                <WhatsappChecklist businessId={id} allowedChats={business.whatsappChats.length} lang={lang} />
              </Suspense>
            </div>
          </details>
        )}
        <LevelUps businessId={id} ups={ups} now={office.now} />
        <div className="min-h-0 flex-1">
          <TeammateView id={id} tid={manager.id} manager embedded />
        </div>
      </div>
    </div>
  );
}
