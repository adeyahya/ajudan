import { connection } from "next/server";
import { Badge, Button } from "@/components/kit";
import { t, type UiLang } from "@/lib/i18n";
import { isLinked, linkState, listGroups, readSyncStatus, type WaGroup } from "@/lib/whatsapp";
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

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg text-foreground">WhatsApp</h2>
        <Badge tone={linked ? "green" : linking ? "amber" : "neutral"}>
          {linked
            ? t(lang, sync.running ? "profile.wa.linkedSyncing" : "profile.wa.linked")
            : t(lang, linking ? "profile.wa.linking" : "profile.wa.notLinked")}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{t(lang, "profile.wa.help")}</p>

      {!linked && !linking && (
        <form action={startWhatsappLink.bind(null, businessId)}>
          <Button type="submit">{t(lang, "profile.wa.link")}</Button>
        </form>
      )}
      {!linked && linking && (
        <div className="grid gap-3">
          <WhatsappQr businessId={businessId} />
          <form action={cancelWhatsappLink}>
            <Button type="submit" variant="ghost">
              {t(lang, "common.cancel")}
            </Button>
          </form>
        </div>
      )}

      {linked && (
        <form action={saveWhatsappChats.bind(null, businessId)} className="grid gap-2">
          <p className="font-pixel text-sm">{t(lang, "profile.wa.chats")}</p>
          {groupsError && <p className="text-xs text-bad">{t(lang, "profile.wa.groupsError", { error: groupsError })}</p>}
          {!groupsError && groups.length === 0 && (
            <p className="text-xs text-muted-foreground pixel-caret">{t(lang, "profile.wa.waitingSync")}</p>
          )}
          <div className="grid max-h-72 gap-1 overflow-y-auto pr-1">
            {parents.map((p) => (
              <div key={p.JID} className="grid gap-1">
                <ChatCheckbox g={p} checked={allowedJids.has(p.JID)} label={t(lang, "profile.wa.community", { name: p.Name })} />
                {children(p).map((c) => (
                  <ChatCheckbox key={c.JID} g={c} checked={allowedJids.has(c.JID)} label={c.Name} indent />
                ))}
              </div>
            ))}
            {loose.map((g) => (
              <ChatCheckbox key={g.JID} g={g} checked={allowedJids.has(g.JID)} label={g.Name} />
            ))}
            {missing.map((c) => (
              <label key={c.jid} className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" name="chat" value={`${c.jid}|${c.name}`} defaultChecked className="size-4" />
                {t(lang, "profile.wa.notSynced", { name: c.name })}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary">
              {t(lang, "profile.wa.saveChats")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {allowed.length ? t(lang, "profile.wa.allowed", { count: allowed.length }) : t(lang, "profile.wa.noneAllowed")} ·{" "}
              {teammatesWithAccess.length
                ? t(lang, "profile.wa.canUse", { names: teammatesWithAccess.join(", ") })
                : t(lang, "profile.wa.turnOn")}
            </span>
          </div>
        </form>
      )}

      {linked && (
        <form action={unlinkWhatsapp.bind(null, businessId)}>
          <Button type="submit" variant="ghost" title={t(lang, "profile.wa.unlinkTitle")}>
            {t(lang, "profile.wa.unlink")}
          </Button>
        </form>
      )}
      {sync.error && <p className="text-xs text-bad">{t(lang, "profile.wa.syncStopped", { error: sync.error })}</p>}
    </div>
  );
}

function ChatCheckbox({ g, checked, label, indent }: { g: WaGroup; checked: boolean; label: string; indent?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 text-sm ${indent ? "pl-6" : ""}`}>
      <input type="checkbox" name="chat" value={`${g.JID}|${g.Name}`} defaultChecked={checked} className="size-4 accent-[var(--primary)]" />
      <span className="truncate">{label}</span>
    </label>
  );
}
