import { connection } from "next/server";
import { Badge, Button } from "@/components/kit";
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
}: {
  businessId: string;
  allowed: { jid: string; name: string }[];
  teammatesWithAccess: string[];
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
        <h2 className="text-lg text-primary">WhatsApp</h2>
        <Badge tone={linked ? "green" : linking ? "amber" : "neutral"}>
          {linked ? (sync.running ? "Linked · syncing" : "Linked") : linking ? "Linking" : "Not linked"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Link the business&apos;s WhatsApp (ideally the business number) as a linked device. Teammates with WhatsApp access
        can read and post only in the chats you tick below. Other chats stay private. It uses wacli and the unofficial
        WhatsApp Web protocol, so keep posting human-paced.
      </p>

      {!linked && !linking && (
        <form action={startWhatsappLink.bind(null, businessId)}>
          <Button type="submit">Link WhatsApp</Button>
        </form>
      )}
      {!linked && linking && (
        <div className="grid gap-3">
          <WhatsappQr businessId={businessId} />
          <form action={cancelWhatsappLink}>
            <Button type="submit" variant="ghost">
              Cancel
            </Button>
          </form>
        </div>
      )}

      {linked && (
        <form action={saveWhatsappChats.bind(null, businessId)} className="grid gap-2">
          <p className="font-pixel text-sm">Chats teammates may use</p>
          {groupsError && <p className="text-xs text-bad">Couldn&apos;t read groups: {groupsError}</p>}
          {!groupsError && groups.length === 0 && (
            <p className="text-xs text-muted-foreground pixel-caret">Waiting for your groups to sync (refresh in a minute)</p>
          )}
          <div className="grid max-h-72 gap-1 overflow-y-auto pr-1">
            {parents.map((p) => (
              <div key={p.JID} className="grid gap-1">
                <ChatCheckbox g={p} checked={allowedJids.has(p.JID)} label={`🏘 ${p.Name} (community)`} />
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
                {c.name} (not synced yet)
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary">
              Save chats
            </Button>
            <span className="text-xs text-muted-foreground">
              {allowed.length ? `${allowed.length} allowed` : "None allowed yet"} ·{" "}
              {teammatesWithAccess.length
                ? `Can use it: ${teammatesWithAccess.join(", ")}`
                : "Turn on “Can use WhatsApp” for a teammate on the Team page"}
            </span>
          </div>
        </form>
      )}

      {linked && (
        <form action={unlinkWhatsapp.bind(null, businessId)}>
          <Button type="submit" variant="ghost" title="Logs this linked device out of WhatsApp">
            Unlink WhatsApp
          </Button>
        </form>
      )}
      {sync.error && <p className="text-xs text-bad">Sync stopped: {sync.error}</p>}
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
