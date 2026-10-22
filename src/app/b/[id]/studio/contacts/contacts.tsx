"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { DownloadIcon, MessageCircleIcon, PlusIcon, UploadIcon } from "lucide-react";
import { Badge, Button, Card, cn, Input, Textarea } from "@/components/kit";
import type { Contact, ContactKind } from "@/db/schema";
import { deleteContactAction, importContactsAction, saveContactAction } from "../actions";

const KINDS: Record<ContactKind, { label: string; tone: "neutral" | "green" | "amber" | "blue" | "violet" }> = {
  customer: { label: "Customer", tone: "green" },
  supplier: { label: "Supplier", tone: "amber" },
  partner: { label: "Partner", tone: "blue" },
  team: { label: "Team", tone: "violet" },
  other: { label: "Other", tone: "neutral" },
};

/** The address book: add, edit, import and export people; teammates can look them up. */
export function Contacts({ businessId, contacts }: { businessId: string; contacts: Contact[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ContactKind | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [open, setOpen] = useState<string | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const tags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags))].sort(), [contacts]);
  const shown = contacts.filter((c) => {
    if (kind !== "all" && c.kind !== kind) return false;
    if (tag && !c.tags.includes(tag)) return false;
    const s = q.trim().toLowerCase();
    return !s || `${c.name} ${c.company ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.notes} ${c.tags.join(" ")}`.toLowerCase().includes(s);
  });
  const current = contacts.find((c) => c.id === open);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <main className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, phone, notes…" className="h-9 max-w-80" />
          {(["all", ...Object.keys(KINDS)] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k as ContactKind | "all")}
              className={cn("font-pixel rounded-md border border-border px-2 py-0.5 text-xs", kind === k ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}
            >
              {k === "all" ? `All ${contacts.length}` : `${KINDS[k as ContactKind].label} ${contacts.filter((c) => c.kind === k).length}`}
            </button>
          ))}
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setImporting(!importing)}>
              <UploadIcon /> Import
            </Button>
            <Button asChild size="sm" variant="secondary">
              <a href={`/api/b/${businessId}/contacts`}>
                <DownloadIcon /> Export CSV
              </a>
            </Button>
            <Button size="sm" onClick={() => setOpen("new")}>
              <PlusIcon /> Add person
            </Button>
          </span>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTag(tag === t ? null : t)}
                className={cn("rounded-full border px-2 py-0.5 text-xs", tag === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
        {importing && <Importer businessId={businessId} onDone={() => setImporting(false)} />}
        <Card className="divide-y divide-border p-0">
          {contacts.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Your address book is empty. Add your regular customers, suppliers and partners, or import a CSV / Google Contacts export. The team can look them up when they work.
            </div>
          ) : shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nobody matches.</p>
          ) : (
            shown.map((c) => (
              <button key={c.id} type="button" onClick={() => setOpen(c.id)} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted", open === c.id && "bg-muted")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-pixel text-sm">{c.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <Badge tone={KINDS[c.kind].tone}>{KINDS[c.kind].label}</Badge>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.company, c.phone && `+${c.phone}`, c.email, c.tags.map((t) => `#${t}`).join(" ")].filter(Boolean).join(" · ") || "No details yet"}
                  </span>
                </span>
              </button>
            ))
          )}
        </Card>
      </main>
      <aside>
        {open ? (
          <ContactForm key={open} businessId={businessId} contact={current} onClose={() => setOpen(null)} />
        ) : (
          <Card className="space-y-2 p-4 text-sm text-muted-foreground">
            <div className="font-pixel text-base text-foreground">Your address book</div>
            <p>Keep who&apos;s who: regular customers, suppliers, resellers. Add notes like &quot;prefers COD&quot; or &quot;VIP: free shipping&quot;.</p>
            <p>When the team is back they can look people up by name, and WhatsApp messages to a saved name go to the right number (new people still need your OK).</p>
          </Card>
        )}
      </aside>
    </div>
  );
}

function ContactForm({ businessId, contact, onClose }: { businessId: string; contact?: Contact; onClose: () => void }) {
  const [f, setF] = useState({
    name: contact?.name ?? "",
    phone: contact?.phone ? `+${contact.phone}` : "",
    email: contact?.email ?? "",
    company: contact?.company ?? "",
    kind: contact?.kind ?? "customer",
    tags: contact?.tags.join(", ") ?? "",
    notes: contact?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <span className="font-pixel">{contact ? "Edit person" : "Add a person"}</span>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground" aria-label="Close">
          ✕
        </button>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await saveContactAction(businessId, { id: contact?.id, ...f });
            if ("error" in r) setError(r.error ?? "Couldn't save this contact.");
            else onClose();
          });
        }}
      >
        <Input value={f.name} onChange={set("name")} placeholder="Name" required autoFocus />
        <Input value={f.phone} onChange={set("phone")} placeholder="Phone / WhatsApp, e.g. +62 812…" inputMode="tel" />
        <Input value={f.email} onChange={set("email")} placeholder="Email" type="email" />
        <Input value={f.company} onChange={set("company")} placeholder="Company / shop" />
        <select value={f.kind} onChange={set("kind")} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
          {Object.entries(KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <Input value={f.tags} onChange={set("tags")} placeholder="Tags: vip, reseller, jakarta" />
        <Textarea value={f.notes} onChange={set("notes")} rows={4} placeholder="Notes: what they buy, preferences, last order…" />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {contact?.phone && (
            <Button asChild variant="secondary">
              <a href={`https://wa.me/${contact.phone}`} target="_blank" rel="noreferrer">
                <MessageCircleIcon /> WhatsApp
              </a>
            </Button>
          )}
          {contact && (
            <Button
              type="button"
              variant="danger"
              className="ml-auto"
              disabled={pending}
              onClick={() => confirm(`Remove ${contact.name}?`) && start(async () => (await deleteContactAction(businessId, contact.id), onClose()))}
            >
              Delete
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function Importer({ businessId, onDone }: { businessId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ added: number; updated: number; skipped: string[]; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="font-pixel">Import contacts</div>
      <p className="text-xs text-muted-foreground">
        A CSV with a header row: <code>name, phone, email, company, kind, tags, notes</code> (Indonesian headers like nama, no hp, catatan work too). Google Contacts and spreadsheet exports are fine. People with the same phone or email are updated, not duplicated.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
          Choose a CSV file
        </Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <span className="self-center text-xs text-muted-foreground">or paste below</span>
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={"name,phone,company,kind,tags\nRina,+6281100000000,Toko Rina,customer,vip"} className="font-mono text-xs" />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending || !text.trim()} onClick={() => start(async () => setResult(await importContactsAction(businessId, text)))}>
          {pending ? "Importing…" : "Import"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
      {result &&
        (result.error ? (
          <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>
        ) : (
          <div className="text-xs">
            <p className="text-emerald-600 dark:text-emerald-400">
              Added {result.added}, updated {result.updated}
              {result.skipped.length ? `, skipped ${result.skipped.length}` : ""}.
            </p>
            {result.skipped.map((s) => (
              <p key={s} className="text-muted-foreground">
                {s}
              </p>
            ))}
          </div>
        ))}
    </Card>
  );
}
