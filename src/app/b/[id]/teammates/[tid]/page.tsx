import { Suspense } from "react";
import { PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { uiLang } from "@/lib/i18n";
import { ConversationList } from "../../_chat/conversation-list";
import { loadConversations } from "../../_chat/data";
import { TeammateView } from "./teammate-view";

type Params = { params: Promise<{ id: string; tid: string }> };

export default function TeammatePage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

/** A teammate's conversation, with the chat home's conversation list beside it on wide screens. */
async function Content({ params }: Params) {
  const { id, tid } = await params;
  const biz = await getBusiness(id);
  if (biz?.status !== "active") return <TeammateView id={id} tid={tid} />;
  const data = await loadConversations(id, uiLang(biz.language));
  return (
    <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <ConversationList data={data} activeId={tid} className="hidden h-[calc(100dvh-var(--chrome-h,8.75rem))] xl:flex" />
      <TeammateView id={id} tid={tid} />
    </div>
  );
}
