"use client";

import { Building2, ClipboardList, Flag, Hash, Mail, MessageCircle, Phone, Tag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useLang, useT } from "@/components/i18n";
import { Avatar, Badge, Button, cn, ConfirmDialog, IconButton, PropertyList, Textarea } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ContactKind } from "@/db/schema";
import { dateLocale, type MessageKey } from "@/lib/i18n";
import { statusTone } from "@/lib/status-tones";
import { deleteContactAction, followUpAction, saveContactAction } from "../actions";
import type { Mate } from "../types";
import { FOLLOW_UP, KIND_TONE, KINDS, type HistoryItem, type PersonRow } from "./shared";

type Form = { name: string; phone: string; email: string; company: string; kind: ContactKind; tags: string; notes: string };

const WATCH_TONE: Record<string, "yellow" | "green" | "gray" | "red"> = { waiting: "yellow", replied: "green", no_reply: "red", closed: "gray" };

/** A borderless property input (Notion: looks like text until hovered or focused). */
function PropInput(props: React.ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "-mx-1.5 h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-foreground outline-none placeholder:text-placeholder",
        "transition-[background-color,border-color] duration-100 hover:bg-hover focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/30",
        props.className,
      )}
    />
  );
}

/**
 * One person in the side peek: name, properties (kind, phone with WhatsApp, email,
 * company, tags, follow-up), the summary the team reads, where they're mentioned, and
 * "ask a teammate to follow up". Edits save on blur; a new person (no `contact`) is
 * created with "Add person".
 */
export function PersonPeek({
  businessId,
  contact,
  history,
  mates,
  managerId,
  onCreated,
  onDeleted,
}: {
  businessId: string;
  contact?: PersonRow;
  history: HistoryItem[] | null;
  mates: Mate[];
  managerId: string | null;
  onCreated: (id: string) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const initial: Form = {
    name: contact?.name ?? "",
    phone: contact?.phone ? `+${contact.phone}` : "",
    email: contact?.email ?? "",
    company: contact?.company ?? "",
    kind: contact?.kind ?? "customer",
    tags: contact?.tags.join(", ") ?? "",
    notes: contact?.notes ?? "",
  };
  const [f, setF] = useState<Form>(initial);
  const [saved, setSaved] = useState<Form>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tags = f.tags.split(",").map((x) => x.trim()).filter(Boolean);
  const followUp = tags.includes(FOLLOW_UP);

  const save = (next: Form = f) => {
    if (!contact) return;
    if (JSON.stringify(next) === JSON.stringify(saved) || !next.name.trim()) return;
    start(async () => {
      const r = await saveContactAction(businessId, { id: contact.id, ...next });
      if ("error" in r) return void toast.error(t("context.peek.saveFailed"), { description: r.error });
      setSaved(next);
      setSavedAt(new Date().toLocaleTimeString(dateLocale(lang), { hour: "2-digit", minute: "2-digit" }));
    });
  };
  const set = (k: keyof Form, v: string, now = false) => {
    const next = { ...f, [k]: v };
    setF(next);
    if (now) save(next);
  };
  const field = (k: "phone" | "email" | "company" | "tags", placeholder: string, extra?: React.ComponentProps<"input">) => (
    <PropInput value={f[k]} placeholder={placeholder} aria-label={placeholder} onChange={(e) => set(k, e.target.value)} onBlur={() => save()} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} {...extra} />
  );
  const phoneDigits = f.phone.replace(/\D/g, "");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start gap-2">
          <textarea
            value={f.name}
            rows={1}
            autoFocus={!contact}
            placeholder={t("context.people.namePlaceholder")}
            aria-label={t("context.col.name")}
            onChange={(e) => set("name", e.target.value.replace(/\n/g, ""))}
            onBlur={() => save()}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
            className="min-w-0 flex-1 resize-none bg-transparent text-xl leading-7 font-semibold text-foreground outline-none [field-sizing:content] placeholder:text-placeholder"
          />
          {contact && (
            <ConfirmDialog
              trigger={
                <IconButton label={t("context.people.delete")}>
                  <Trash2 />
                </IconButton>
              }
              title={t("context.people.deleteConfirm", { name: contact.name })}
              body={t("context.people.deleteBody")}
              confirmLabel={t("common.delete")}
              cancelLabel={t("common.cancel")}
              destructive
              onConfirm={() =>
                start(async () => {
                  await deleteContactAction(businessId, contact.id);
                  toast(t("context.people.deleted", { name: contact.name }));
                  onDeleted();
                })
              }
            />
          )}
        </div>
        {contact && <p className="mt-0.5 h-4 text-xs text-tertiary">{pending ? t("common.saving") : savedAt ? `${t("common.saved")} · ${savedAt}` : ""}</p>}
      </div>

      <PropertyList
        className="grid-cols-[minmax(0,120px)_minmax(0,1fr)]"
        items={[
          {
            icon: <Tag />,
            label: t("context.col.kind"),
            value: (
              <Select value={f.kind} onValueChange={(v) => set("kind", v, true)}>
                <SelectTrigger size="sm" className="-mx-2 border-transparent bg-transparent shadow-none" aria-label={t("context.col.kind")}>
                  <SelectValue>
                    <Badge tone={KIND_TONE[f.kind]}>{t(`context.kind.${f.kind}` as MessageKey)}</Badge>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      <Badge tone={KIND_TONE[k]}>{t(`context.kind.${k}` as MessageKey)}</Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ),
          },
          {
            icon: <Phone />,
            label: t("context.col.phone"),
            value: (
              <span className="flex w-full min-w-0 items-center gap-1">
                {field("phone", t("context.people.phonePlaceholder"), { inputMode: "tel", className: "font-mono" })}
                {contact && phoneDigits.length > 6 && (
                  <IconButton label={t("context.people.whatsapp")} asChild>
                    <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer">
                      <MessageCircle />
                    </a>
                  </IconButton>
                )}
              </span>
            ),
          },
          { icon: <Mail />, label: t("context.people.email"), value: field("email", t("context.people.emailPlaceholder"), { type: "email" }) },
          { icon: <Building2 />, label: t("context.col.company"), value: field("company", t("context.people.companyPlaceholder")) },
          { icon: <Hash />, label: t("context.col.tags"), value: field("tags", t("context.people.tagsPlaceholder")) },
          {
            icon: <Flag />,
            label: t("context.peek.tagFollowUp"),
            value: (
              <Switch
                checked={followUp}
                aria-label={t("context.peek.tagFollowUp")}
                onCheckedChange={(on) => set("tags", (on ? [...tags, FOLLOW_UP] : tags.filter((x) => x !== FOLLOW_UP)).join(", "), true)}
              />
            ),
          },
        ]}
      />

      <section>
        <h3 className="text-[13px] leading-[18px] font-semibold">{t("context.peek.summary")}</h3>
        <p className="mt-0.5 mb-2 text-xs text-muted-foreground">{t("context.peek.summaryHelp")}</p>
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} onBlur={() => save()} rows={5} placeholder={t("context.people.notesPlaceholder")} aria-label={t("context.peek.summary")} className="text-sm leading-[22px]" />
      </section>

      {!contact ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            loading={pending}
            disabled={!f.name.trim()}
            onClick={() =>
              start(async () => {
                const r = await saveContactAction(businessId, f);
                if ("error" in r) return void toast.error(t("context.peek.saveFailed"), { description: r.error });
                toast(t("context.people.added", { name: f.name.trim() }));
                onCreated(r.id);
              })
            }
          >
            {t("context.people.add")}
          </Button>
        </div>
      ) : (
        <>
          <History items={history} lang={lang} />
          {mates.length > 0 && <FollowUp businessId={businessId} contactId={contact.id} mates={mates} managerId={managerId} />}
        </>
      )}
    </div>
  );
}

function History({ items, lang }: { items: HistoryItem[] | null; lang: "en" | "id" }) {
  const t = useT();
  return (
    <section>
      <h3 className="mb-2 text-[13px] leading-[18px] font-semibold">{t("context.peek.history")}</h3>
      {items === null ? (
        <p className="text-xs text-tertiary">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("context.peek.noHistory")}</p>
      ) : (
        <ul className="-mx-2">
          {items.map((h) => {
            const tone = h.kind === "task" ? statusTone("task", h.status) : { tone: WATCH_TONE[h.status] ?? "gray", label: `context.watch.${h.status}` as MessageKey };
            const body = (
              <>
                {h.kind === "whatsapp" ? <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-tertiary" aria-hidden /> : <ClipboardList className="mt-0.5 size-3.5 shrink-0 text-tertiary" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-[18px]">{h.title}</span>
                  <span className="block truncate text-xs text-tertiary">
                    {h.who} · {new Date(h.at).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" })}
                  </span>
                </span>
                <Badge tone={tone.tone}>{t(tone.label)}</Badge>
              </>
            );
            const cls = "flex items-start gap-2 rounded-md px-2 py-1.5";
            return (
              <li key={h.id}>
                {h.href ? (
                  <Link href={h.href} className={cn(cls, "transition-colors duration-100 hover:bg-hover")}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FollowUp({ businessId, contactId, mates, managerId }: { businessId: string; contactId: string; mates: Mate[]; managerId: string | null }) {
  const t = useT();
  const router = useRouter();
  const [mate, setMate] = useState(mates.find((m) => m.id !== managerId)?.id ?? mates[0]?.id ?? "");
  const [ask, setAsk] = useState("");
  const [pending, start] = useTransition();
  const name = mates.find((m) => m.id === mate)?.name ?? "";
  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="mb-2 text-[13px] leading-[18px] font-semibold">{t("context.peek.followUp")}</h3>
      <Select value={mate} onValueChange={setMate}>
        <SelectTrigger size="sm" className="w-full" aria-label={t("context.peek.followUp")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {mates.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <Avatar seed={m.id} name={m.name} color={m.color} size={16} />
              {m.name}
              <span className="text-tertiary">· {m.title}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} placeholder={t("context.peek.followUpPlaceholder")} aria-label={t("context.peek.followUpPlaceholder")} className="mt-2 text-sm" />
      <Button
        size="sm"
        className="mt-2"
        loading={pending}
        disabled={!mate}
        onClick={() =>
          start(async () => {
            const r = await followUpAction(businessId, contactId, mate, ask);
            if (!("ok" in r)) return void toast.error(t("context.peek.followUpFailed"));
            setAsk("");
            toast(t("context.peek.followUpSent", { manager: r.manager ?? "", name }), {
              action: { label: t("common.open"), onClick: () => router.push(`/b/${businessId}/teammates/${r.managerId}`) },
            });
          })
        }
      >
        {t("context.peek.followUpAsk", { name })}
      </Button>
    </section>
  );
}
