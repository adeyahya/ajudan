import { Loader2, MessageCircle, Users } from "lucide-react";
import { connection } from "next/server";
import { Badge, EmptyState, Section, cn } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { t, type UiLang } from "@/lib/i18n";
import { isLinked, linkState, listGroups, readSyncStatus, type WaGroup } from "@/lib/whatsapp";
import { ActionForm, SubmitButton } from "../team/action-form";
import { cancelWhatsappLink, saveWhatsappChats, startWhatsappLink, unlinkWhatsapp } from "./actions";
import { WhatsappQr } from "./whatsapp-link";

/**
 * The business's WhatsApp (via wacli). The owner links it once by scanning a QR,
 * then picks which groups/communities teammates may read and post in.
 */
export async function WhatsappPanel({
  businessId,
  allowed,
  teammatesWithAccess,
  lang,
}: {
  businessId: string;
  allowed: { jid: string; name: string }[];
  teammatesWithAccess: string[];
  lang: UiLang;
}) {
  await connection();
  const link = await linkState();
  const linking = link.state === "qr" || link.state === "starting";
  const linked = link.state === "linked" || (!linking && (await isLinked()));
  const sync = readSyncStatus();
  let groups: WaGroup[] = [];
  let groupsError: string | undefined;
  if (linked) {
    try {
      groups = await listGroups();
    } catch (err) {
      groupsError = err instanceof Error ? err.message : String(err);
    }
  }
  const allowedJids = new Set(allowed.map((c) => c.jid));
  // Communities first, then their groups, then other groups.
  const parents = groups.filter((g) => g.IsParent);
  const children = (p: WaGroup) => groups.filter((g) => g.LinkedParentJID === p.JID);
  const loose = groups.filter((g) => !g.IsParent && !parents.some((p) => p.JID === g.LinkedParentJID));
  const missing = allowed.filter((c) => !groups.some((g) => g.JID === c.jid));
  const status = linked
    ? { tone: "green" as const, label: t(lang, sync.running ? "profile.wa.linkedSyncing" : "profile.wa.linked") }
    : { tone: linking ? ("yellow" as const) : ("gray" as const), label: t(lang, linking ? "profile.wa.linking" : "profile.wa.notLinked") };

  return (
    <div>
      <Section
        title="WhatsApp"
        description={t(lang, "profile.wa.help")}
        actions={
          <>
            <Badge tone={status.tone}>{status.label}</Badge>
            {!linked && !linking && (
              <ActionForm action={startWhatsappLink.bind(null, businessId)}>
                <SubmitButton size="sm">{t(lang, "profile.wa.link")}</SubmitButton>
              </ActionForm>
            )}
          </>
        }
      >
        {!linked && linking && (
          <div className="grid gap-3">
            <WhatsappQr businessId={businessId} />
            <ActionForm action={cancelWhatsappLink}>
              <SubmitButton size="sm" variant="ghost">
                {t(lang, "common.cancel")}
              </SubmitButton>
            </ActionForm>
          </div>
        )}
        {!linked && !linking && <EmptyState compact icon={<MessageCircle />} title={t(lang, "profile.wa.notLinked")} body={t(lang, "profile.wa.linkBody")} />}
        {sync.error && <p className="mt-3 text-[13px] text-destructive">{t(lang, "profile.wa.syncStopped", { error: sync.error })}</p>}
      </Section>

      {linked && (
        <Section title={t(lang, "profile.wa.chats")} description={teammatesWithAccess.length ? t(lang, "profile.wa.canUse", { names: teammatesWithAccess.join(", ") }) : t(lang, "profile.wa.turnOn")}>
          <ActionForm action={saveWhatsappChats.bind(null, businessId)} success={t(lang, "profile.toast.chats")} className="grid gap-3">
            {groupsError && <p className="text-[13px] text-destructive">{t(lang, "profile.wa.groupsError", { error: groupsError })}</p>}
            {!groupsError && groups.length === 0 && (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-tertiary motion-reduce:animate-none" />
                {t(lang, "profile.wa.waitingSync")}
              </p>
            )}
            {(groups.length > 0 || missing.length > 0) && (
              <div className="max-h-96 overflow-y-auto rounded-lg border border-border p-1">
                {parents.map((p) => (
                  <div key={p.JID}>
                    <ChatRow value={`${p.JID}|${p.Name}`} checked={allowedJids.has(p.JID)} label={p.Name} community={t(lang, "profile.wa.communityTag")} />
                    {children(p).map((c) => (
                      <ChatRow key={c.JID} value={`${c.JID}|${c.Name}`} checked={allowedJids.has(c.JID)} label={c.Name} indent />
                    ))}
                  </div>
                ))}
                {loose.map((g) => (
                  <ChatRow key={g.JID} value={`${g.JID}|${g.Name}`} checked={allowedJids.has(g.JID)} label={g.Name} />
                ))}
                {missing.map((c) => (
                  <ChatRow key={c.jid} value={`${c.jid}|${c.name}`} checked label={t(lang, "profile.wa.notSynced", { name: c.name })} muted />
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton size="sm" variant="secondary">
                {t(lang, "profile.wa.saveChats")}
              </SubmitButton>
              <span className="text-xs text-tertiary">{allowed.length ? t(lang, "profile.wa.allowed", { count: allowed.length }) : t(lang, "profile.wa.noneAllowed")}</span>
            </div>
          </ActionForm>
        </Section>
      )}

      {linked && (
        <Section title={t(lang, "profile.wa.deviceTitle")} description={t(lang, "profile.wa.unlinkTitle")}>
          <ActionForm action={unlinkWhatsapp.bind(null, businessId)} success={t(lang, "profile.toast.unlinked")}>
            <SubmitButton size="sm" variant="danger">
              {t(lang, "profile.wa.unlink")}
            </SubmitButton>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}

function ChatRow({ value, checked, label, indent, community, muted }: { value: string; checked: boolean; label: string; indent?: boolean; community?: string; muted?: boolean }) {
  const id = `chat-${value.split("|")[0].replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 hover:bg-hover", indent && "pl-7")}>
      <Checkbox id={id} name="chat" value={value} defaultChecked={checked} />
      <label htmlFor={id} className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[13px] leading-[18px]", muted ? "text-muted-foreground" : "text-foreground")}>
        {community && <Users className="size-4 shrink-0 text-tertiary" />}
        <span className={cn("truncate", community && "font-medium")}>{label}</span>
        {community && <Badge>{community}</Badge>}
      </label>
    </div>
  );
}
