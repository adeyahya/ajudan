import { Suspense } from "react";
import { ChatSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { uiLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ConversationChips, ConversationList } from "../../_chat/conversation-list";
import { loadConversations } from "../../_chat/data";
import { CHAT_H } from "../../_chat/chat-height";
import { TeammateView } from "./teammate-view";

type Params = { params: Promise<{ id: string; tid: string }> };

export default function TeammatePage(props: Params) {
  return (
    <Suspense
      fallback={
        <div data-full-bleed className={cn(CHAT_H, "mx-auto w-full max-w-3xl px-4")}>
          <ChatSkeleton />
        </div>
      }
    >
      <Content params={props.params} />
    </Suspense>
  );
}

/**
 * A teammate's conversation, full height under the top bar, with the chat home's
 * conversation list beside it (lg+) or as a row of chips (phones). Their profile opens
 * as a side peek (`?about=1`).
 */
async function Content({ params }: Params) {
  const { id, tid } = await params;
  const biz = await getBusiness(id);
  if (biz?.status !== "active") {
    return (
      <div data-full-bleed className={cn(CHAT_H, "flex")}>
        <TeammateView id={id} tid={tid} />
      </div>
    );
  }
  const data = await loadConversations(id, uiLang(biz.language));
  return (
    // Below 1536px the list makes room for the profile peek (the chat keeps a readable width).
    <div data-full-bleed className={cn(CHAT_H, "flex max-2xl:[&:has([data-about-peek])>nav]:hidden")}>
      <ConversationList data={data} activeId={tid} className="hidden w-[280px] shrink-0 lg:flex" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConversationChips data={data} activeId={tid} className="border-b border-border lg:hidden" />
        <div className="flex min-h-0 flex-1">
          <TeammateView id={id} tid={tid} manager={tid === data.managerId} />
        </div>
      </div>
    </div>
  );
}
