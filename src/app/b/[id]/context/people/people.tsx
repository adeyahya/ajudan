"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageCircleIcon, XIcon } from "lucide-react";
import { useLang, useT } from "@/components/i18n";
import { Badge, Button, Card, cn, Input, Textarea } from "@/components/kit";
import type { Contact, ContactKind } from "@/db/schema";
import { dateLocale, type MessageKey } from "@/lib/i18n";
import { followUpAction, saveContactAction } from "../actions";
import type { Mate } from "../workspace";

export type PersonRow = Omit<Contact, "createdAt"> & { createdAt: string };
export type HistoryItem = { kind: "task" | "whatsapp"; id: string; title: string; who: string; status: string; at: string; href: string | null };

const KINDS: ContactKind[] = ["customer", "supplier", "partner", "team", "other"];
const TONE: Record<ContactKind, "green" | "amber" | "blue" | "violet" | "neutral"> = { customer: "green", supplier: "amber", partner: "blue", team: "violet", other: "neutral" };
const FOLLOW_UP = "follow-up";
const NEW_DAYS = 30;

type View = "all" | "follow_up" | "new_wa" | ContactKind;

/** Saved views: everyone, who needs a follow-up, new from WhatsApp, and each kind. */
function inView(c: PersonRow, view: View) {
  if (view === "all") return true;
  if (view === "follow_up") return c.tags.includes(FOLLOW_UP);
  if (view === "new_wa") return c.tags.includes("whatsapp") && Date.now() - new Date(c.createdAt).getTime() < NEW_DAYS * 86_400_000;
  return c.kind === view;
}

export function People({ businessId, contacts, openId, history, mates, managerId }: { businessId: string; contacts: PersonRow[]; openId: string | null; history: HistoryItem[]; mates: Mate[]; managerId: string | null }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const base = `/b/${businessId}/context/people`;
  const views: { key: View; label: string }[] = [
    { key: "all", label: t("context.view.all") },
    { key: "follow_up", label: t("context.view.followUp") },
    { key: "new_wa", label: t("context.view.newWa") },
    ...KINDS.map((k) => ({ key: k, label: t(`context.kind.${k}` as MessageKey) })),
  ];
  const s = q.trim().toLowerCase();
  const shown = contacts.filter((c) => inView(c, view) && (!s || `${c.name} ${c.company ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.notes} ${c.tags.join(" ")}`.toLowerCase().includes(s)));
  const open = contacts.find((c) => c.id === openId);
  const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short", year: "2-digit" });

  return (
    <div className={cn("grid gap-4", open && "lg:grid-cols-[minmax(0,1fr)_24rem]")}>
      <main className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn("font-pixel rounded-md border border-border px-2 py-0.5 text-xs", view === v.key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {v.label} <span className="opacity-70">{contacts.filter((c) => inView(c, v.key)).length}</span>
            </button>
          ))}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("context.search")} className="ml-auto h-8 max-w-56" />
        </div>
        {(view === "follow_up" || view === "new_wa") && <p className="text-xs text-muted-foreground">{t(view === "follow_up" ? "context.view.followUpHelp" : "context.view.newWaHelp")}</p>}
        <Card className="overflow-x-auto p-0">
          {contacts.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("context.people.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  {(["name", "kind", "phone", "company", "tags", "added"] as const).map((k) => (
                    <th key={k} className="px-3 py-2 font-normal">
                      {t(`context.col.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`${base}?c=${c.id}`)} className={cn("cursor-pointer border-b border-border/60 hover:bg-muted", c.id === openId && "bg-muted")}>
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">
                      <Badge tone={TONE[c.kind]}>{t(`context.kind.${c.kind}` as MessageKey)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{c.phone ? `+${c.phone}` : ""}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.company}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{c.tags.map((x) => `#${x}`).join(" ")}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{date(c.createdAt)}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-sm text-muted-foreground">
                      {t("context.people.noMatch")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Card>
        <Link href={`/b/${businessId}/studio/contacts`} className="inline-block text-xs text-muted-foreground underline hover:text-foreground">
          {t("context.people.manage")}
        </Link>
      </main>
      {open && <Peek key={open.id} businessId={businessId} c={open} history={history} mates={mates} managerId={managerId} onClose={() => router.push(base)} />}
    </div>
  );
}

function Peek({ businessId, c, history, mates, managerId, onClose }: { businessId: string; c: PersonRow; history: HistoryItem[]; mates: Mate[]; managerId: string | null; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [notes, setNotes] = useState(c.notes);
  const [kind, setKind] = useState<ContactKind>(c.kind);
  const [tags, setTags] = useState(c.tags.join(", "));
  const [saved, setSaved] = useState<string | null>(null);
  const [mate, setMate] = useState(mates.find((m) => m.id !== managerId)?.id ?? mates[0]?.id ?? "");
  const [ask, setAsk] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const manager = mates.find((m) => m.id === managerId);
  const input = { id: c.id, name: c.name, phone: c.phone ?? "", email: c.email ?? "", company: c.company ?? "", kind, tags, notes };
  const save = (patch: Partial<typeof input> = {}) =>
    start(async () => {
      const r = await saveContactAction(businessId, { ...input, ...patch });
      setSaved("error" in r ? (r.error ?? "") : t("context.peek.saved"));
    });
  const followUp = c.tags.includes(FOLLOW_UP);
  return (
    <aside className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-pixel truncate text-xl text-foreground">{c.name}</h2>
            {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={t("context.peek.close")} className="text-muted-foreground hover:text-foreground">
            <XIcon className="size-4" />
          </button>
        </div>
        <div>
          <h3 className="pb-1 text-xs text-muted-foreground">{t("context.peek.properties")}</h3>
          <dl className="grid grid-cols-[6rem_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
            <dt className="text-xs text-muted-foreground">{t("context.col.kind")}</dt>
            <dd>
              <select value={kind} onChange={(e) => (setKind(e.target.value as ContactKind), save({ kind: e.target.value as ContactKind }))} className="h-7 border border-border bg-background px-1 text-sm">
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`context.kind.${k}` as MessageKey)}
                  </option>
                ))}
              </select>
            </dd>
            <dt className="text-xs text-muted-foreground">{t("context.col.phone")}</dt>
            <dd className="flex items-center gap-2">
              {c.phone ? `+${c.phone}` : "—"}
              {c.phone && (
                <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="WhatsApp">
                  <MessageCircleIcon className="size-3.5" />
                </a>
              )}
            </dd>
            {c.email && (
              <>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="truncate">{c.email}</dd>
              </>
            )}
            <dt className="text-xs text-muted-foreground">{t("context.col.tags")}</dt>
            <dd>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => tags !== c.tags.join(", ") && save()} className="h-7 text-sm" />
            </dd>
            <dt className="text-xs text-muted-foreground">{t("context.peek.tagFollowUp")}</dt>
            <dd>
              <input
                type="checkbox"
                checked={followUp}
                onChange={() => {
                  const next = followUp ? c.tags.filter((x) => x !== FOLLOW_UP) : [...c.tags, FOLLOW_UP];
                  setTags(next.join(", "));
                  save({ tags: next.join(", ") });
                }}
              />
            </dd>
          </dl>
        </div>
        <div className="space-y-1">
          <h3 className="text-xs text-muted-foreground">{t("context.peek.summary")}</h3>
          <p className="text-[11px] text-muted-foreground">{t("context.peek.summaryHelp")}</p>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} className="text-sm" />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={pending || notes === c.notes} onClick={() => save()}>
              {t("context.peek.save")}
            </Button>
            {saved && <span className="text-xs text-muted-foreground">{saved}</span>}
          </div>
        </div>
      </Card>

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">{t("context.peek.history")}</h3>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("context.peek.noHistory")}</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {history.map((h) => {
              const body = (
                <>
                  <span className="block truncate">
                    {h.kind === "whatsapp" ? "WhatsApp · " : ""}
                    {h.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {h.who} · {new Date(h.at).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" })} · {h.status}
                  </span>
                </>
              );
              return <li key={h.id}>{h.href ? <Link href={h.href} className="block hover:text-primary">{body}</Link> : body}</li>;
            })}
          </ul>
        )}
      </Card>

      {mates.length > 0 && (
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("context.peek.followUp")}</h3>
          <select value={mate} onChange={(e) => setMate(e.target.value)} className="h-8 w-full border border-border bg-background px-1 text-sm">
            {mates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.title}
              </option>
            ))}
          </select>
          <Textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} placeholder={t("context.peek.followUpPlaceholder")} className="text-sm" />
          <Button
            size="sm"
            disabled={pending || !mate}
            onClick={() =>
              start(async () => {
                const r = await followUpAction(businessId, c.id, mate, ask);
                if ("ok" in r) {
                  setSent(t("context.peek.followUpSent", { manager: r.manager ?? "", name: mates.find((m) => m.id === mate)?.name ?? "" }));
                  setAsk("");
                }
              })
            }
          >
            {t("context.peek.followUpAsk", { name: mates.find((m) => m.id === mate)?.name ?? "" })}
          </Button>
          {sent && (
            <p className="text-xs text-emerald-400">
              {sent}{" "}
              {manager && (
                <Link href={`/b/${businessId}/manager`} className="underline">
                  {manager.name} →
                </Link>
              )}
            </p>
          )}
        </Card>
      )}
    </aside>
  );
}
