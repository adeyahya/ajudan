"use client";

import { Bookmark, Building2, Calendar, CalendarClock, Download, Ellipsis, GitMerge, Hash, Phone, Tag, Trash2, Type, Upload, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useLang, useT } from "@/components/i18n";
import { useGrowingList } from "@/components/use-growing-list";
import { DataTable, DataTableToolbar, TableSearch, type Column } from "@/components/data-table";
import { Badge, Button, EmptyState, IconButton, Input, Label, LineTabs, PageBody, Textarea } from "@/components/kit";
import { useBreadcrumb } from "@/components/breadcrumb";
import { SidePeek, SidePeekLayout, useUrlPeek } from "@/components/side-peek";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FOLLOW_UP_FILTERS, inSegment, isDue, type FollowUpFilter } from "@/lib/contact-filters";
import type { TimelineItem } from "@/lib/contact-timeline";
import { dateLocale, type MessageKey } from "@/lib/i18n";
import type { Mate } from "@/app/b/[id]/context/types";
import { deleteSegmentAction, findDuplicatesAction, importContactsAction, mergeContactsAction, saveSegmentAction, type DuplicateGroupView } from "./actions";
import { PersonPeek } from "./person-peek";
import { FOLLOW_UP, KIND_TONE, KINDS, type PersonRow, type SegmentView, type View } from "./shared";

const NEW_DAYS = 30;

/** Built-in views: everyone, due follow-ups, anyone with a follow-up, new from WhatsApp, and each kind. */
function inView(c: PersonRow, view: View) {
  if (view === "all") return true;
  if (view === "due") return isDue(c.followUpAt);
  if (view === "follow_up") return !!c.followUpAt || c.tags.includes(FOLLOW_UP);
  if (view === "new_wa") return c.tags.includes("whatsapp") && Date.now() - new Date(c.createdAt).getTime() < NEW_DAYS * 86_400_000;
  return c.kind === view;
}

const HELP: Partial<Record<View, MessageKey>> = { due: "contacts.view.dueHelp", follow_up: "contacts.view.followUpHelp", new_wa: "context.view.newWaHelp" };

/**
 * Contacts: the address book as a Notion database. Views and saved segments as line tabs
 * (?view=, ?seg=), a search box, Import/Export/Duplicates/Segments in the "…" menu, "New
 * person"; a row opens the person in the side peek (?c=<id>, or ?c=new to add someone).
 */
export function People({
  businessId,
  contacts,
  view,
  segments,
  segmentId,
  timeline,
  mates,
  managerId,
}: {
  businessId: string;
  contacts: PersonRow[];
  view: View;
  segments: SegmentView[];
  segmentId: string | null;
  timeline: { contactId: string; items: TimelineItem[] } | null;
  mates: Mate[];
  managerId: string | null;
}) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const peek = useUrlPeek("c");
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const [dupes, setDupes] = useState(false);
  const [segmentDraft, setSegmentDraft] = useState<SegmentDraft | null>(null);
  const [, start] = useTransition();
  const base = `/b/${businessId}/contacts`;
  const segment = segments.find((s) => s.id === segmentId);
  const views: { key: View; label: string }[] = [
    { key: "all", label: t("context.view.all") },
    { key: "due", label: t("contacts.view.due") },
    { key: "follow_up", label: t("contacts.view.followUp") },
    { key: "new_wa", label: t("context.view.newWa") },
    ...KINDS.map((k) => ({ key: k, label: t(`context.kind.${k}` as MessageKey) })),
  ];
  const s = q.trim().toLowerCase();
  const matches = (c: PersonRow) => (segment ? inSegment(c, segment) : inView(c, view));
  const shown = contacts.filter(
    (c) => matches(c) && (!s || `${c.name} ${c.company ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.notes} ${c.tags.join(" ")} ${Object.values(c.fields).join(" ")}`.toLowerCase().includes(s)),
  );
  const { visible, sentinel } = useGrowingList(shown, `${segmentId ?? view}\0${s}`, 200);
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
    {
      key: "followUp",
      header: t("contacts.followUp.label"),
      icon: <CalendarClock />,
      width: 130,
      cell: (c) => (c.followUpAt ? <Badge tone={isDue(c.followUpAt) ? "red" : "gray"}>{date(c.followUpAt)}</Badge> : null),
      title: (c) => c.followUpNote || undefined,
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
          timeline={open && timeline?.contactId === open.id ? timeline.items : null}
          mates={mates}
          managerId={managerId}
          onCreated={(id) => peek.open(id)}
          onDeleted={peek.close}
        />
      )}
    </SidePeek>
  );

  const builtInDraft = (): SegmentDraft => ({
    name: "",
    kind: (KINDS as string[]).includes(view) ? view : "",
    tags: "",
    text: q.trim(),
    followUp: view === "due" ? "due" : view === "follow_up" ? "set" : "any",
  });

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
              items={[
                ...views.map((v) => ({
                  href: v.key === "all" ? base : `${base}?view=${v.key}`,
                  label: v.label,
                  active: !segment && view === v.key,
                  count: contacts.filter((c) => inView(c, v.key)).length,
                })),
                ...segments.map((sg) => ({
                  href: `${base}?seg=${sg.id}`,
                  label: sg.name,
                  icon: <Bookmark />,
                  active: segment?.id === sg.id,
                  count: contacts.filter((c) => inSegment(c, sg)).length,
                })),
              ]}
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
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => setImporting(true)}>
                <Upload />
                {t("contacts.import.menu")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/b/${businessId}/contacts`} download>
                  <Download />
                  {t("context.people.export")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/b/${businessId}/contacts?format=vcf`} download>
                  <Download />
                  {t("contacts.export.vcf")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDupes(true)}>
                <GitMerge />
                {t("contacts.dupes.menu")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSegmentDraft(segment ? { ...segment, kind: segment.kind ?? "", tags: segment.tags.join(", ") } : builtInDraft())}>
                <Bookmark />
                {segment ? t("contacts.segment.edit") : t("contacts.segment.save")}
              </DropdownMenuItem>
              {segment && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    start(async () => {
                      await deleteSegmentAction(businessId, segment.id);
                      toast(t("contacts.segment.deleted", { name: segment.name }));
                      router.push(base);
                    })
                  }
                >
                  <Trash2 />
                  {t("contacts.segment.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => peek.open("new")}>
            <UserPlus />
            {t("context.people.new")}
          </Button>
        </DataTableToolbar>
        {!segment && HELP[view] && <p className="mb-2 text-xs text-tertiary">{t(HELP[view]!)}</p>}
        {contacts.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={t("context.people.emptyTitle")}
            body={t("context.people.empty")}
            action={
              <>
                <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
                  <Upload />
                  {t("contacts.import.menu")}
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
            minWidth={1020}
            empty={<EmptyState compact title={t("context.people.noMatch")} />}
          />
        )}
        {sentinel}
      </PageBody>
      <ImportDialog businessId={businessId} open={importing} onOpenChange={setImporting} />
      <DuplicatesDialog businessId={businessId} open={dupes} onOpenChange={setDupes} />
      <SegmentDialog
        businessId={businessId}
        draft={segmentDraft}
        onClose={() => setSegmentDraft(null)}
        onSaved={(id) => {
          setSegmentDraft(null);
          router.push(`${base}?seg=${id}`);
        }}
      />
    </SidePeekLayout>
  );
}

/** Import a CSV or vCard (file or pasted): people with the same phone or email are updated. */
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
          <DialogDescription>{t("contacts.import.help")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
              <Upload />
              {t("contacts.import.choose")}
            </Button>
            <span className="text-xs text-tertiary">{t("context.import.orPaste")}</span>
            <input
              ref={file}
              type="file"
              accept=".csv,.tsv,.txt,.vcf,text/csv,text/vcard,text/x-vcard"
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
                if (r.error) return void toast.error(t("context.import.failed"), { description: t("contacts.import.format") });
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

/** Groups of people who look like the same person; Merge keeps the first and folds the rest into it. */
function DuplicatesDialog({ businessId, open, onOpenChange }: { businessId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [groups, setGroups] = useState<DuplicateGroupView[] | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const load = () =>
    start(async () => {
      setGroups(await findDuplicatesAction(businessId));
      setKeep({});
    });
  const describe = (c: PersonRow) => [c.phone && `+${c.phone}`, c.email, c.company].filter(Boolean).join(" · ");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) load();
        else setGroups(null);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("contacts.dupes.title")}</DialogTitle>
          <DialogDescription>{t("contacts.dupes.help")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {groups === null ? (
            <p className="text-xs text-tertiary">{t("common.loading")}</p>
          ) : groups.length === 0 ? (
            <EmptyState compact title={t("contacts.dupes.none")} />
          ) : (
            groups.map((g) => {
              const all = [g.keep, ...g.others];
              const groupKey = all.map((c) => c.id).join(",");
              const keepId = keep[groupKey] ?? g.keep.id;
              return (
                <div key={groupKey} className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-xs text-tertiary">{t("contacts.dupes.why", { reasons: g.reasons.map((r) => t(`contacts.dupes.reason.${r}` as MessageKey)).join(", ") })}</p>
                  <div role="radiogroup" aria-label={t("contacts.dupes.keep")} className="space-y-1">
                    {all.map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-hover">
                        <input type="radio" name={groupKey} className="mt-1 accent-primary" checked={keepId === c.id} onChange={() => setKeep({ ...keep, [groupKey]: c.id })} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{c.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{describe(c) || "—"}</span>
                        </span>
                        {keepId === c.id && <Badge tone="green">{t("contacts.dupes.keep")}</Badge>}
                      </label>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    loading={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await mergeContactsAction(
                          businessId,
                          keepId,
                          all.map((c) => c.id).filter((id) => id !== keepId),
                        );
                        if ("error" in r) return void toast.error(t("contacts.dupes.failed"), { description: r.error });
                        toast(t("contacts.dupes.merged", { count: r.merged + 1, name: all.find((c) => c.id === keepId)?.name ?? "" }));
                        setGroups(await findDuplicatesAction(businessId));
                      })
                    }
                  >
                    <GitMerge />
                    {t("contacts.dupes.merge", { count: all.length })}
                  </Button>
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SegmentDraft = { id?: string; name: string; kind: string; tags: string; text: string; followUp: FollowUpFilter };

const ANY = "_any";

/** Save the current filters as a segment, or change a saved one. */
function SegmentDialog({ businessId, draft, onClose, onSaved }: { businessId: string; draft: SegmentDraft | null; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT();
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{draft?.id ? t("contacts.segment.edit") : t("contacts.segment.save")}</DialogTitle>
          <DialogDescription>{t("contacts.segment.help")}</DialogDescription>
        </DialogHeader>
        {draft && <SegmentForm key={draft.id ?? "new"} businessId={businessId} draft={draft} onCancel={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function SegmentForm({ businessId, draft, onCancel, onSaved }: { businessId: string; draft: SegmentDraft; onCancel: () => void; onSaved: (id: string) => void }) {
  const t = useT();
  const [d, setD] = useState(draft);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveSegmentAction(businessId, { ...d, kind: d.kind || null });
          if ("error" in r) return void toast.error(t("context.peek.saveFailed"), { description: r.error });
          onSaved(r.id);
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="seg-name">{t("contacts.segment.name")}</Label>
        <Input id="seg-name" value={d.name} autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={t("contacts.segment.namePlaceholder")} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>{t("context.col.kind")}</Label>
          <Select value={d.kind || ANY} onValueChange={(v) => setD({ ...d, kind: v === ANY ? "" : v })}>
            <SelectTrigger size="sm" aria-label={t("context.col.kind")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("contacts.segment.anyKind")}</SelectItem>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`context.kind.${k}` as MessageKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>{t("contacts.followUp.label")}</Label>
          <Select value={d.followUp} onValueChange={(v) => setD({ ...d, followUp: v as FollowUpFilter })}>
            <SelectTrigger size="sm" aria-label={t("contacts.followUp.label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FOLLOW_UP_FILTERS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`contacts.segment.followUp.${f}` as MessageKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="seg-tags">{t("context.col.tags")}</Label>
        <Input id="seg-tags" value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} placeholder={t("context.people.tagsPlaceholder")} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="seg-text">{t("contacts.segment.text")}</Label>
        <Input id="seg-text" value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} placeholder={t("contacts.segment.textPlaceholder")} />
      </div>
      <DialogFooter>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" loading={pending} disabled={!d.name.trim()}>
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
