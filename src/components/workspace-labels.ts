import type { ObjectType } from "@/db/schema";
import type { MessageKey } from "@/lib/i18n";
import type { Actor, HistoryAction } from "@/lib/object-history";

/** Labels shared by Home, Trash, the object panel and the Inbox's team changes (server and client). */

type T = (key: MessageKey) => string;

export const typeLabel = (t: T, type: ObjectType) => t(`workspace.type.${type}`);

export const actionLabel = (t: T, action: HistoryAction) => t(`workspace.action.${action}`);

/** "You", "Ajudan", the teammate's name, or "A teammate" when they're gone. */
export function actorLabel(t: T, a: Actor) {
  if (a.kind === "teammate") return a.name ?? t("workspace.by.teammate");
  return t(a.kind === "system" ? "workspace.by.system" : "workspace.by.you");
}
