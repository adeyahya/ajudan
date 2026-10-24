"use client";

import {
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Check,
  ClipboardList,
  FileText,
  GitMerge,
  Hash,
  History as HistoryIcon,
  Link2,
  ListPlus,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  StickyNote,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useLang, useT } from "@/components/i18n";
import { Avatar, Badge, Button, cn, ConfirmDialog, IconButton, PropertyList, Textarea, type BadgeTone } from "@/components/kit";
import { ObjectPanel } from "@/components/object-panel";
import { Segmented } from "@/components/workspace-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContactKind } from "@/db/schema";
import { isDue } from "@/lib/contact-filters";
import type { TimelineItem } from "@/lib/contact-timeline";
import type { InteractionKind } from "@/lib/contacts";
import { dateLocale, type MessageKey } from "@/lib/i18n";
import { statusTone } from "@/lib/status-tones";
import { completeFollowUpAction, deleteContactAction, followUpAction, logInteractionAction, saveContactAction, setFollowUpAction } from "./actions";
import type { Mate } from "@/app/b/[id]/context/types";
import { INTERACTIONS, KIND_TONE, KINDS, type PersonRow } from "./shared";

type Form = { name: string; phone: string; email: string; company: string; kind: ContactKind; tags: string; notes: string; fields: [string, string][] };

const WATCH_TONE: Record<string, BadgeTone> = { waiting: "yellow", replied: "green", no_reply: "red", closed: "gray" };

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

/** "2026-11-02" in local time, for a date input. */
const localDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const toFields = (pairs: [string, string][]) => Object.fromEntries(pairs.map(([k, v]) => [k.trim(), v.trim()]).filter(([k, v]) => k && v));

/**
 * One person in the side peek: name, properties (kind, phone with WhatsApp, email,
 * company, tags, follow-up, custom fields), the summary the team reads, a box to log a
 * call/meeting/note, their timeline, links and history (ObjectPanel), and "ask a
 * teammate to follow up". Edits save on blur; a new person (no `contact`) is created
 * with "Add person".
 */
export function PersonPeek({
  businessId,
  contact,
  timeline,
  mates,
  managerId,
  onCreated,
  onDeleted,
}: {
  businessId: string;
  contact?: PersonRow;
  timeline: TimelineItem[] | null;
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
    fields: Object.entries(contact?.fields ?? {}),
  };
  const [f, setF] = useState<Form>(initial);
  const [saved, setSaved] = useState<Form>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const payload = (next: Form) => ({ ...next, fields: toFields(next.fields) });
  const save = (next: Form = f) => {
    if (!contact) return;
    if (JSON.stringify(payload(next)) === JSON.stringify(payload(saved)) || !next.name.trim()) return;
    start(async () => {
      const r = await saveContactAction(businessId, { id: contact.id, ...payload(next) });
      if ("error" in r) return void toast.error(t("context.peek.saveFailed"), { description: r.error });
      setSaved(next);
      setSavedAt(new Date().toLocaleTimeString(dateLocale(lang), { hour: "2-digit", minute: "2-digit" }));
    });
  };
  const set = <K extends keyof Form>(k: K, v: Form[K], now = false) => {
    const next = { ...f, [k]: v };
    setF(next);
    if (now) save(next);
  };
  const field = (k: "phone" | "email" | "company" | "tags", placeholder: string, extra?: React.ComponentProps<"input">) => (
    <PropInput value={f[k]} placeholder={placeholder} aria-label={placeholder} onChange={(e) => set(k, e.target.value)} onBlur={() => save()} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} {...extra} />
  );
  const phoneDigits = f.phone.replace(/\D/g, "");
  const setPair = (i: number, pair: [string, string]) => set("fields", f.fields.map((p, j) => (j === i ? pair : p)));

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
              <Select value={f.kind} onValueChange={(v) => set("kind", v as ContactKind, true)}>
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
          ...(contact ? [{ icon: <CalendarClock />, label: t("contacts.followUp.label"), value: <FollowUpProp key={`${contact.followUpAt}|${contact.followUpNote}`} businessId={businessId} contact={contact} /> }] : []),
          ...f.fields.map(([k, v], i) => ({
            icon: <ListPlus />,
            label: (
              <PropInput
                value={k}
                placeholder={t("contacts.fields.key")}
                aria-label={t("contacts.fields.key")}
                onChange={(e) => setPair(i, [e.target.value, v])}
                onBlur={() => save()}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="text-muted-foreground"
              />
            ),
            value: (
              <span className="flex w-full min-w-0 items-center gap-1">
                <PropInput
                  value={v}
                  placeholder={t("contacts.fields.value")}
                  aria-label={k || t("contacts.fields.value")}
                  onChange={(e) => setPair(i, [k, e.target.value])}
                  onBlur={() => save()}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <IconButton
                  label={t("contacts.fields.remove")}
                  onClick={() =>
                    set(
                      "fields",
                      f.fields.filter((_, j) => j !== i),
                      true,
                    )
                  }
                >
                  <X />
                </IconButton>
              </span>
            ),
          })),
        ]}
      />
      <Button size="sm" variant="ghost" className="-mt-4 text-muted-foreground" onClick={() => set("fields", [...f.fields, ["", ""]])}>
        <Plus />
        {t("contacts.fields.add")}
      </Button>

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
                const r = await saveContactAction(businessId, payload(f));
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
          <LogInteraction businessId={businessId} contactId={contact.id} />
          <Timeline items={timeline} name={contact.name} />
          <ObjectPanel businessId={businessId} objectRef={{ type: "contact", id: contact.id }} />
          {mates.length > 0 && <AskTeammate businessId={businessId} contactId={contact.id} mates={mates} managerId={managerId} />}
        </>
      )}
    </div>
  );
}

/** The follow-up property: a date (saved on change), what for (saved on blur), and Done. */
function FollowUpProp({ businessId, contact }: { businessId: string; contact: PersonRow }) {
  const t = useT();
  const [day, setDay] = useState(localDay(contact.followUpAt));
  const [note, setNote] = useState(contact.followUpNote);
  const [pending, start] = useTransition();
  const due = isDue(contact.followUpAt);
  const send = (d: string, n: string) =>
    start(async () => {
      const r = await setFollowUpAction(businessId, contact.id, d || null, n);
      if ("error" in r) toast.error(t("context.peek.saveFailed"), { description: r.error });
    });
  return (
    <div className="w-full min-w-0">
      <span className="flex min-w-0 items-center gap-1">
        <PropInput
          type="date"
          value={day}
          aria-label={t("contacts.followUp.date")}
          onChange={(e) => {
            setDay(e.target.value);
            send(e.target.value, note);
          }}
          className={cn("w-auto", due && "text-destructive")}
        />
        {due && <Badge tone="red">{t("contacts.followUp.due")}</Badge>}
        {contact.followUpAt && (
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            className="ml-auto h-7"
            onClick={() =>
              start(async () => {
                const r = await completeFollowUpAction(businessId, contact.id);
                if ("error" in r) return void toast.error(t("context.peek.saveFailed"), { description: r.error });
                toast(t("contacts.followUp.doneToast", { name: contact.name }));
              })
            }
          >
            <Check />
            {t("contacts.followUp.markDone")}
          </Button>
        )}
      </span>
      {day && (
        <PropInput
          value={note}
          placeholder={t("contacts.followUp.notePlaceholder")}
          aria-label={t("contacts.followUp.notePlaceholder")}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== contact.followUpNote && send(day, note)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      )}
    </div>
  );
}

function LogInteraction({ businessId, contactId }: { businessId: string; contactId: string }) {
  const t = useT();
  const [kind, setKind] = useState<InteractionKind>("call");
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    text.trim() &&
    start(async () => {
      const r = await logInteractionAction(businessId, contactId, kind, text);
      if ("error" in r) return void toast.error(t("context.peek.saveFailed"), { description: r.error });
      setText("");
    });
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] leading-[18px] font-semibold">{t("contacts.log.title")}</h3>
        <Segmented value={kind} onChange={setKind} label={t("contacts.log.kind")} options={INTERACTIONS.map((k) => ({ value: k, label: t(`contacts.interaction.${k}` as MessageKey) }))} />
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={t(`contacts.log.placeholder.${kind}` as MessageKey)}
        aria-label={t("contacts.log.title")}
        className="text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <Button size="sm" variant="secondary" className="mt-2" loading={pending} disabled={!text.trim()} onClick={submit}>
        {t("contacts.log.button")}
      </Button>
    </section>
  );
}

const INTERACTION_ICON: Record<InteractionKind, React.ReactNode> = {
  call: <Phone />,
  meeting: <Users />,
  note: <StickyNote />,
  message: <MessageSquare />,
};

function itemIcon(i: TimelineItem) {
  switch (i.kind) {
    case "whatsapp":
    case "watch":
      return <MessageCircle />;
    case "task":
      return <ClipboardList />;
    case "deliverable":
      return <FileText />;
    case "link":
      return <Link2 />;
    case "interaction":
      return INTERACTION_ICON[i.interaction ?? "note"];
    case "follow_up":
      return i.followUp === "done" ? <CalendarCheck /> : i.followUp === "clear" ? <CalendarX /> : <CalendarClock />;
    case "change":
      return i.change === "merge" ? <GitMerge /> : <HistoryIcon />;
  }
}

/** Everything with this person, newest first (src/lib/contact-timeline.ts). */
function Timeline({ items, name }: { items: TimelineItem[] | null; name: string }) {
  const t = useT();
  const lang = useLang();
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short", year: "numeric" });
  const who = (i: TimelineItem) => i.who ?? (i.by === "owner" ? t("contacts.timeline.you") : undefined);

  const describe = (i: TimelineItem): { title: string; label: string; badge?: { tone: BadgeTone; label: string } } => {
    switch (i.kind) {
      case "whatsapp":
        return { title: i.title || t("contacts.timeline.media"), label: i.direction === "in" ? t("contacts.timeline.waFrom", { name }) : t("contacts.timeline.waTo", { name }) };
      case "watch":
        return {
          title: i.title,
          label: i.direction === "in" ? t("contacts.timeline.watchReply", { name }) : t("contacts.timeline.watchSent"),
          badge: i.status && i.direction === "out" ? { tone: WATCH_TONE[i.status] ?? "gray", label: t(`context.watch.${i.status}` as MessageKey) } : undefined,
        };
      case "task": {
        const s = statusTone("task", i.status ?? "");
        return { title: i.title, label: t("contacts.timeline.task"), badge: { tone: s.tone, label: t(s.label) } };
      }
      case "deliverable": {
        const s = statusTone("deliverable", i.status ?? "");
        return { title: i.title, label: t("contacts.timeline.deliverable"), badge: { tone: s.tone, label: t(s.label) } };
      }
      case "link":
        return { title: i.title, label: t(i.direction === "out" ? "contacts.timeline.linkOut" : "contacts.timeline.linkIn") };
      case "interaction":
        return { title: i.title, label: t(`contacts.interaction.${i.interaction ?? "note"}` as MessageKey) };
      case "follow_up":
        return {
          title: i.title || (i.followUpAt ? day(i.followUpAt) : ""),
          label: t(`contacts.timeline.followUp.${i.followUp ?? "set"}` as MessageKey, { date: i.followUpAt ? day(i.followUpAt) : "" }),
        };
      case "change":
        return { title: i.change === "merge" ? t("contacts.timeline.merged", { count: i.detail ?? "" }) : t(`contacts.timeline.change.${i.change ?? "create"}` as MessageKey), label: t("contacts.timeline.contact") };
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-[13px] leading-[18px] font-semibold">{t("contacts.timeline.title")}</h3>
      {items === null ? (
        <p className="text-xs text-tertiary">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("contacts.timeline.empty")}</p>
      ) : (
        <ol className="-mx-2">
          {items.map((i) => {
            const d = describe(i);
            const by = who(i);
            const body = (
              <>
                <span className="mt-0.5 shrink-0 text-tertiary [&>svg]:size-3.5" aria-hidden>
                  {itemIcon(i)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13px] leading-[18px]", i.kind === "interaction" ? "break-words whitespace-pre-wrap" : "truncate")}>{d.title}</span>
                  <span className="block truncate text-xs text-tertiary">{[d.label, by, when(i.at)].filter(Boolean).join(" · ")}</span>
                </span>
                {d.badge && <Badge tone={d.badge.tone}>{d.badge.label}</Badge>}
              </>
            );
            const cls = "flex items-start gap-2 rounded-md px-2 py-1.5";
            return (
              <li key={i.id}>
                {i.href ? (
                  <Link href={i.href} className={cn(cls, "transition-colors duration-100 hover:bg-hover")}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function AskTeammate({ businessId, contactId, mates, managerId }: { businessId: string; contactId: string; mates: Mate[]; managerId: string | null }) {
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
