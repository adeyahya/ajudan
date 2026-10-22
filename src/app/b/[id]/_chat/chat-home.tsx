import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Business } from "@/db/schema";
import type { UiLang } from "@/lib/i18n";
import { ensureManager } from "@/lib/manager";
import { cn } from "@/lib/utils";
import { WhatsappChecklist } from "../manager/whatsapp-checklist";
import { loadOffice } from "../office/state";
import { TeammateView } from "../teammates/[tid]/teammate-view";
import { CHAT_H } from "./chat-height";
import { ConversationChips, ConversationList } from "./conversation-list";
import { loadConversations } from "./data";
import { LevelUps, type LevelUpCard } from "./level-ups";
import { OfficeStrip } from "./office-strip";
import { WhatsappBanner } from "./whatsapp-banner";

/**
 * The business home once the team is hired (G1, chat-first): conversations on the left
 * (chips on a phone), the living office as a strip on top, and the owner's conversation
 * with the manager under it, filling the viewport under the top bar. `?compose=1` (the
 * palette's "Give a task") focuses the composer (handled in Chat).
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
    <div data-full-bleed className={cn(CHAT_H, "grid lg:grid-cols-[280px_minmax(0,1fr)]")}>
      <ConversationList data={data} activeId={manager.id} className="hidden lg:flex" />
      <div className="flex min-h-0 min-w-0 flex-col">
        <ConversationChips data={data} activeId={manager.id} className="border-b border-border lg:hidden" />
        <div className="flex shrink-0 flex-col gap-2 empty:hidden md:px-3 md:pt-3">
          <OfficeStrip businessId={id} businessName={business.name} initialState={office.state} initialNow={office.now} />
          {!business.ownerHumanId && (
            <div className="max-md:px-3 max-md:pt-2">
              <WhatsappBanner businessId={id}>
                {/* Its own boundary: checking the WhatsApp link shells out to wacli and shouldn't hold up the chat. */}
                <Suspense fallback={<div className="h-40" />}>
                  <WhatsappChecklist businessId={id} allowedChats={business.whatsappChats.length} lang={lang} />
                </Suspense>
              </WhatsappBanner>
            </div>
          )}
        </div>
        <LevelUps businessId={id} ups={ups} now={office.now} />
        <div className="flex min-h-0 flex-1 flex-col">
          <TeammateView id={id} tid={manager.id} manager embedded />
        </div>
      </div>
    </div>
  );
}
