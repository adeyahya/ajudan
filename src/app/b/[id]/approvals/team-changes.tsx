import Link from "next/link";
import { connection } from "next/server";
import { Avatar, Section } from "@/components/kit";
import { ObjectTypeIcon } from "@/components/object-type-icon";
import { actionLabel, actorLabel, typeLabel } from "@/components/workspace-labels";
import { t, type MessageKey, type UiLang } from "@/lib/i18n";
import { describeRef } from "@/lib/links";
import { actorResolver, canUndoEntry, recentTeamHistory, supersededIds } from "@/lib/object-history";
import { fullTime, relativeTime } from "../deliverables/format";
import { UndoChangeButton } from "./undo-change-button";

async function loadTeamChanges(businessId: string, limit: number) {
  await connection();
  const entries = recentTeamHistory(businessId, limit);
  const superseded = supersededIds(businessId, entries);
  const actor = actorResolver(businessId);
  const rows = entries.flatMap((e) => {
    const info = describeRef(businessId, { type: e.objectType, id: e.objectId });
    if (!info) return []; // gone for good
    return [{ entry: e, info, actor: actor(e.by), superseded: superseded.has(e.id), undoable: canUndoEntry(e) }];
  });
  return { rows, now: Date.now() };
}

/**
 * Inbox → "Recent changes by the team": the last teammate changes in object_history
 * (docs, library, contacts), each with Undo while nothing newer happened to that object.
 */
export async function TeamChanges({ businessId, lang, limit = 15 }: { businessId: string; lang: UiLang; limit?: number }) {
  const { rows, now } = await loadTeamChanges(businessId, limit);
  if (!rows.length) return null;
  const tr = (key: MessageKey) => t(lang, key);
  return (
    <Section title={t(lang, "workspace.undo.title")} description={t(lang, "workspace.undo.description")} className="mt-10">
      <ul className="divide-y divide-border border-y border-border">
        {rows.map(({ entry, info, actor, superseded, undoable }) => (
          <li key={entry.id} className="flex min-h-11 items-center gap-3 py-1.5">
            {actor.teammateId && actor.color ? (
              <Avatar seed={actor.teammateId} name={actor.name ?? ""} color={actor.color} size={24} />
            ) : (
              <ObjectTypeIcon type={info.type} />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] leading-[18px] text-foreground">
                <span className="font-medium">{actorLabel(tr, actor)}</span>
                <span className="text-muted-foreground"> · {actionLabel(tr, entry.action)} · </span>
                <Link href={info.href} className={info.deleted ? "text-tertiary line-through hover:underline" : "hover:underline"}>
                  {info.title}
                </Link>
              </p>
              <p className="truncate text-xs text-tertiary">
                {typeLabel(tr, info.type)} · <span title={fullTime(entry.createdAt, lang)}>{relativeTime(entry.createdAt, lang, now)}</span>
              </p>
            </div>
            {superseded ? (
              <span className="shrink-0 text-xs text-tertiary">{t(lang, "workspace.undo.changedSince")}</span>
            ) : undoable ? (
              <UndoChangeButton businessId={businessId} historyId={entry.id} />
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
