"use client";

import { Calendar, Building2, Download, Ellipsis, Hash, Phone, Tag, Type, Upload, UserPlus, Users } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useLang, useT } from "@/components/i18n";
import { useGrowingList } from "@/components/use-growing-list";
import { DataTable, DataTableToolbar, TableSearch, type Column } from "@/components/data-table";
import { Badge, Button, EmptyState, IconButton, LineTabs, PageBody, Textarea } from "@/components/kit";
import { useBreadcrumb } from "@/components/breadcrumb";
import { SidePeek, SidePeekLayout, useUrlPeek } from "@/components/side-peek";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { importContactsAction } from "@/app/b/[id]/studio/actions";
import { dateLocale, type MessageKey } from "@/lib/i18n";
import type { Mate } from "../types";
import { PersonPeek } from "./person-peek";
import { FOLLOW_UP, KIND_TONE, KINDS, type HistoryItem, type PersonRow, type View } from "./shared";

const NEW_DAYS = 30;

/** Saved views: everyone, who needs a follow-up, new from WhatsApp, and each kind. */
function inView(c: PersonRow, view: View) {
  if (view === "all") return true;
  if (view === "follow_up") return c.tags.includes(FOLLOW_UP);
  if (view === "new_wa") return c.tags.includes("whatsapp") && Date.now() - new Date(c.createdAt).getTime() < NEW_DAYS * 86_400_000;
  return c.kind === view;
}

/**
 * Konteks → People: the address book as a Notion database. Views as line tabs (?view=),
 * a search box, Import/Export in the "…" menu, "New person"; a row opens the person in
 * the side peek (?c=<id>, or ?c=new to add someone).
 */
export function People({
  businessId,
  contacts,
  view,
  history,
  mates,
  managerId,
}: {
  businessId: string;
  contacts: PersonRow[];
  view: View;
  history: { contactId: string; items: HistoryItem[] } | null;
  mates: Mate[];
  managerId: string | null;
}) {
  const t = useT();
  const lang = useLang();
  const peek = useUrlPeek("c");
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const base = `/b/${businessId}/context/people`;
  const views: { key: View; label: string }[] = [
    { key: "all", label: t("context.view.all") },
    { key: "follow_up", label: t("context.view.followUp") },
    { key: "new_wa", label: t("context.view.newWa") },
    ...KINDS.map((k) => ({ key: k, label: t(`context.kind.${k}` as MessageKey) })),
  ];
  const s = q.trim().toLowerCase();
  const shown = contacts.filter((c) => inView(c, view) && (!s || `${c.name} ${c.company ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.notes} ${c.tags.join(" ")}`.toLowerCase().includes(s)));
  const { visible, sentinel } = useGrowingList(shown, `${view}\0${s}`, 200);
  const creating = peek.value === "new";
  const open = creating ? undefined : contacts.find((c) => c.id === peek.value);
  useBreadcrumb([{ label: t("context.people.title"), href: base }, ...(open ? [{ label: open.name }] : [])]);
  const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short", year: "numeric" });

  const columns: Column<PersonRow>[] = [
    { key: "name", header: t("context.col.name"), icon: <Type />, cell: (c) => c.name, title: (c) => c.name },
    { key: "kind", header: t("context.col.kind"), icon: <Tag />, width: 112, cell: (c) => <Badge tone={KIND_TONE[c.kind]}>{t(`context.kind.${c.kind}` as MessageKey)}</Badge> },
    { key: "phone", header: t("context.col.phone"), icon: <Phone />, width: 150, cell: (c) => (c.phone ? <span className="font-mono text-[13px] text-muted-foreground">+{c.phone}</span> : null) },
    { key: "company", header: t("context.col.company"), icon: <Building2 />, width: 140, cell: (c) => <span className="text-muted-foreground">{c.company}</span>, title: (c) => c.company ?? undefined },
    {
      key: "tags",
      header: t("context.col.tags"),
      icon: <Hash />,
      width: 160,
      cell: (c) => (
        <span className="flex gap-1 overflow-hidden">
          {c.tags.map((x) => (
            <Badge key={x} tone={x === FOLLOW_UP ? "yellow" : "gray"}>
              {x}
            </Badge>
          ))}
        </span>
      ),
      title: (c) => c.tags.join(", "),
    },
    { key: "added", header: t("context.col.added"), icon: <Calendar />, width: 110, cell: (c) => <span className="text-xs text-tertiary">{date(c.createdAt)}</span> },
  ];

  const peekPane = (
    <SidePeek open={creating || !!open} onClose={peek.close} title={creating ? t("context.people.new") : t("context.people.person")} description={open?.name}>
      {(creating || open) && (
        <PersonPeek
          key={open?.id ?? "new"}
          businessId={businessId}
          contact={open}
          history={open && history?.contactId === open.id ? history.items : null}
          mates={mates}
          managerId={managerId}
          onCreated={(id) => peek.open(id)}
          onDeleted={peek.close}
        />
      )}
    </SidePeek>
  );

  return (
    <SidePeekLayout peek={peekPane}>
      <PageBody width="wide">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Users aria-hidden className="mb-3 size-8 text-foreground" strokeWidth={1.5} />
            <h1 className="text-[28px] leading-[34px] font-bold tracking-tight">{t("context.people.title")}</h1>
            <p className="mt-1.5 max-w-[60ch] text-sm leading-[22px] text-muted-foreground">{t("context.people.description")}</p>
          </div>
        </header>
        <DataTableToolbar
          views={
            <LineTabs
              label={t("context.people.title")}
              items={views.map((v) => ({
                href: v.key === "all" ? base : `${base}?view=${v.key}`,
                label: v.label,
                active: view === v.key,
                count: contacts.filter((c) => inView(c, v.key)).length,
              }))}
            />
          }
        >
          <TableSearch value={q} onChange={setQ} placeholder={t("context.search")} className="w-36 sm:w-56" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={t("context.people.more")}>
                <Ellipsis />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setImporting(true)}>
                <Upload />
                {t("context.people.import")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/b/${businessId}/contacts`} download>
                  <Download />
                  {t("context.people.export")}
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => peek.open("new")}>
            <UserPlus />
            {t("context.people.new")}
          </Button>
        </DataTableToolbar>
        {(view === "follow_up" || view === "new_wa") && <p className="mb-2 text-xs text-tertiary">{t(view === "follow_up" ? "context.view.followUpHelp" : "context.view.newWaHelp")}</p>}
        {contacts.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={t("context.people.emptyTitle")}
            body={t("context.people.empty")}
            action={
              <>
                <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
                  <Upload />
                  {t("context.people.import")}
                </Button>
                <Button size="sm" onClick={() => peek.open("new")}>
                  <UserPlus />
                  {t("context.people.new")}
                </Button>
              </>
            }
          />
        ) : (
          <DataTable
            label={t("context.people.title")}
            rows={visible}
            columns={columns}
            getRowId={(c) => c.id}
            onRowOpen={(c) => peek.open(c.id)}
            selectedId={open?.id ?? null}
            minWidth={900}
            empty={<EmptyState compact title={t("context.people.noMatch")} />}
          />
        )}
        {sentinel}
      </PageBody>
      <ImportDialog businessId={businessId} open={importing} onOpenChange={setImporting} />
    </SidePeekLayout>
  );
}

/** Import a CSV (file or pasted): Studio's import, which merges people by phone or email. */
function ImportDialog({ businessId, open, onOpenChange }: { businessId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && (setText(""), setSkipped([])))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("context.import.title")}</DialogTitle>
          <DialogDescription>{t("context.import.help")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
              <Upload />
              {t("context.import.choose")}
            </Button>
            <span className="text-xs text-tertiary">{t("context.import.orPaste")}</span>
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
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label={t("context.import.title")} placeholder={"name,phone,company,kind,tags\nRina,+6281100000000,Toko Rina,customer,vip"} className="font-mono text-xs" />
          {skipped.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
              {skipped.map((x) => (
                <p key={x}>{x}</p>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button
            size="sm"
            loading={pending}
            disabled={!text.trim()}
            onClick={() =>
              start(async () => {
                const r = await importContactsAction(businessId, text);
                if ("error" in r && r.error) return void toast.error(t("context.import.failed"), { description: t("context.import.format") });
                toast(t("context.import.done", { added: r.added, updated: r.updated, skipped: r.skipped.length }));
                setSkipped(r.skipped);
                if (r.skipped.length) return;
                onOpenChange(false);
                setText("");
              })
            }
          >
            {t("context.import.button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
