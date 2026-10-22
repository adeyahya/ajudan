import { getProgress, listTeammates, pendingApprovalCount } from "@/lib/data";
import { deskChats } from "@/lib/desk";
import type { UiLang } from "@/lib/i18n";
import { MANAGER_ROLE } from "@/lib/roles";
import type { ConversationData } from "./conversation-list";

/** Everything the conversation list shows. Awaits connection() (through the helpers) before reading. */
export async function loadConversations(businessId: string, lang: UiLang): Promise<ConversationData> {
  const [teammates, pendingApprovals, progress] = await Promise.all([
    listTeammates(businessId),
    pendingApprovalCount(businessId),
    getProgress(businessId),
  ]);
  return {
    businessId,
    lang,
    teammates,
    managerId: teammates.find((m) => m.roleKey === MANAGER_ROLE.key)?.id ?? null,
    pendingApprovals,
    deskChats: deskChats(businessId).length,
    progress,
  };
}
