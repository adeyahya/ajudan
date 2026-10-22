"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DatabaseIcon, FileTextIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useLang, useT, useTn } from "@/components/i18n";
import { Avatar, Badge, Button, Card, cn } from "@/components/kit";
import type { ContextSection, ReaderMode } from "@/db/schema";
import { SECTIONS, type DiffLine } from "@/lib/context-text";
import { dateLocale } from "@/lib/i18n";
import { createPageAction, decideSuggestionAction, deletePageAction, markCheckedAction, movePageAction, renamePageAction, savePageAction, setReaderAction } from "./actions";
import type { EditorData } from "./editor";

// ProseMirror needs the browser: the editor only renders on the client.
const PageEditor = dynamic(() => import("./editor"), { ssr: false, loading: () => <EditorLoading /> });

function EditorLoading() {
  const t = useT();
  return <p className="px-1 py-6 text-sm text-[#8a6f5a]">{t("context.loadingEditor")}</p>;
}

export type PageSummary = { id: string; title: string; section: ContextSection; kind: "page" | "database"; key: string | null; parentId: string | null; pending: number };
export type CurrentPage = PageSummary & {
  body: string;
  blocks: unknown[] | null;
  externalStamp: string | null;
  owner: { kind: "owner" | "system" | "teammate"; name?: string };
  lastCheckedAt: string | null;
};
export type Mate = { id: string; name: string; color: string; title: string };
export type ReaderView = { teammateId: string; mode: ReaderMode };
export type SuggestionView = {
  id: string;
  kind: "append" | "replace" | "new_page";
  author: string | null;
  authorId: string | null;
  fromChat: boolean;
  reason: string;
  source: string;
  createdAt: string;
  body: string;
  title: string | null;
  section: ContextSection | null;
  changedSince: boolean;
  diff: (DiffLine | { op: "skip"; count: number })[];
};
export type UsageView = { runs: number; fetched: number; byTeammate: { id: string; count: number }[] };

export function ContextWorkspace(p: {
  businessId: string;
  pages: PageSummary[];
  current: CurrentPage | null;
  mates: Mate[];
  readers: ReaderView[];
  suggestions: SuggestionView[];
  newPageSuggestions: SuggestionView[];
  otherPending: { pageId: string; title: string; count: number }[];
  usage: UsageView;
  contactsCount: number;
  editor: Omit<EditorData, "openPage" | "openContact">;
}) {
  const router = useRouter();
  const t = useT();
  const base = `/b/${p.businessId}/context`;
  const editorData: EditorData = {
    ...p.editor,
    openPage: (id) => router.push(`${base}?page=${id}`),
    openContact: (id) => router.push(`${base}/people?c=${id}`),
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_18rem]">
      <PageTree businessId={p.businessId} pages={p.pages} currentId={p.current?.id ?? null} />
      <section className="min-w-0">
        {p.current ? (
          <PageView key={p.current.id} businessId={p.businessId} page={p.current} mates={p.mates} readers={p.readers} contactsCount={p.contactsCount} editor={editorData} />
        ) : (
          <Card className="p-6 text-sm text-muted-foreground">{t("context.pickPage")}</Card>
        )}
      </section>
      <aside className="space-y-4">
        <SuggestionsPanel businessId={p.businessId} suggestions={[...p.suggestions, ...p.newPageSuggestions]} mates={p.mates} otherPending={p.otherPending} />
        {p.current && p.current.kind === "page" && <ReadersPanel businessId={p.businessId} pageId={p.current.id} mates={p.mates} readers={p.readers} />}
        {p.current && <UsagePanel usage={p.usage} mates={p.mates} />}
      </aside>
    </div>
  );
}

function PageTree({ businessId, pages, currentId }: { businessId: string; pages: PageSummary[]; currentId: string | null }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const base = `/b/${businessId}/context`;
  const row = (pg: PageSummary, depth: number): React.ReactNode => (
    <li key={pg.id}>
      <Link
        href={`${base}?page=${pg.id}`}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-muted",
          pg.id === currentId ? "bg-secondary text-foreground" : "text-muted-foreground",
        )}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {pg.kind === "database" ? <DatabaseIcon className="size-3.5 shrink-0" /> : <FileTextIcon className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{pg.title}</span>
        {pg.pending > 0 && <span className="size-2 shrink-0 bg-primary" title={String(pg.pending)} />}
      </Link>
      {pages.some((c) => c.parentId === pg.id) && <ul>{pages.filter((c) => c.parentId === pg.id).map((c) => row(c, depth + 1))}</ul>}
    </li>
  );
  const ids = new Set(pages.map((x) => x.id));
  return (
    <nav className="space-y-3 lg:sticky lg:top-4 lg:self-start">
      {SECTIONS.map((s) => {
        const top = pages.filter((x) => x.section === s && (!x.parentId || !ids.has(x.parentId)));
        return (
          <div key={s}>
            <div className="group flex items-center justify-between px-2 pb-1">
              <span className="font-pixel text-xs uppercase tracking-wide text-primary">{t(`context.section.${s}`)}</span>
              <button
                type="button"
                disabled={pending}
                title={t("context.newPageIn", { section: t(`context.section.${s}`) })}
                aria-label={t("context.newPageIn", { section: t(`context.section.${s}`) })}
                className="text-muted-foreground opacity-60 hover:text-foreground group-hover:opacity-100"
                onClick={() =>
                  start(async () => {
                    const id = await createPageAction(businessId, s, t("context.untitled"));
                    router.push(`${base}?page=${id}`);
                  })
                }
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
            <ul>{top.map((pg) => row(pg, 0))}</ul>
          </div>
        );
      })}
    </nav>
  );
}

function PageView({ businessId, page, mates, readers, contactsCount, editor }: { businessId: string; page: CurrentPage; mates: Mate[]; readers: ReaderView[]; contactsCount: number; editor: EditorData }) {
  const t = useT();
  const tn = useTn();
  const lang = useLang();
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<{ body: string; blocks: unknown[] } | null>(null);

  const flush = async () => {
    clearTimeout(timer.current);
    const v = latest.current;
    if (!v) return;
    latest.current = null;
    setStatus("saving");
    try {
      const r = await savePageAction(businessId, page.id, v);
      setStatus("ok" in r ? "saved" : "failed");
    } catch {
      latest.current = latest.current ?? v;
      setStatus("failed");
    }
  };
  // Leaving the page (or the tab) saves what's left.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush reads refs only
  }, []);

  const always = mates.filter((m) => readers.find((r) => r.teammateId === m.id)?.mode === "always");
  const needed = mates.filter((m) => readers.find((r) => r.teammateId === m.id)?.mode === "when_needed");
  const owner = page.owner.kind === "owner" ? t("context.by.owner") : page.owner.kind === "system" ? t("context.by.system") : t("context.by.teammate", { name: page.owner.name ?? "" });
  const checked = page.lastCheckedAt ? new Date(page.lastCheckedAt).toLocaleDateString(dateLocale(lang), { dateStyle: "medium" }) : t("context.never");

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== page.title && start(() => renamePageAction(businessId, page.id, title))}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          readOnly={page.kind === "database"}
          className="font-pixel min-w-0 flex-1 bg-transparent text-2xl text-primary outline-none drop-shadow-[2px_2px_0_var(--frame)]"
          aria-label="Title"
        />
        <span className="pt-2 text-xs text-muted-foreground">
          {status === "saving" ? t("context.saving") : status === "saved" ? t("context.saved") : status === "failed" ? t("context.saveFailed") : ""}
        </span>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t("context.prop.readBy")}</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          {always.map((m) => (
            <Avatar key={m.id} seed={m.id} name={m.name} color={m.color} size={18} />
          ))}
          <span>{t("context.readBySummary", { always: always.length, needed: needed.length })}</span>
        </dd>
        <dt className="text-muted-foreground">{t("context.prop.owner")}</dt>
        <dd>{owner}</dd>
        <dt className="text-muted-foreground">{t("context.prop.lastChecked")}</dt>
        <dd className="flex items-center gap-2">
          {checked}
          <Button size="xs" variant="ghost" onClick={() => start(() => markCheckedAction(businessId, page.id))}>
            ✓ {t("context.markChecked")}
          </Button>
        </dd>
        {page.kind === "page" && (
          <>
            <dt className="text-muted-foreground">{t("context.prop.section")}</dt>
            <dd className="flex items-center gap-2">
              <select
                value={page.section}
                onChange={(e) => start(() => movePageAction(businessId, page.id, e.target.value as ContextSection))}
                className="h-6 border border-border bg-background px-1 text-xs"
              >
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`context.section.${s}`)}
                  </option>
                ))}
              </select>
              {!page.key && (
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-red-400"
                  onClick={() =>
                    confirm(t("context.deleteConfirm", { title: page.title })) &&
                    start(async () => {
                      await deletePageAction(businessId, page.id);
                      router.push(`/b/${businessId}/context`);
                    })
                  }
                >
                  <Trash2Icon className="size-3.5" /> {t("context.deletePage")}
                </button>
              )}
            </dd>
          </>
        )}
      </dl>

      {page.kind === "database" ? (
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <DatabaseIcon className="size-5 text-primary" />
            <Badge tone="blue">{t("context.database")}</Badge>
            <span className="text-sm text-muted-foreground">{tn("context.dbCount", contactsCount)}</span>
          </div>
          <p className="text-sm text-muted-foreground">{t("context.dbIntro")}</p>
          <Button asChild size="sm">
            <Link href={`/b/${businessId}/context/people`}>{t("context.dbOpen")}</Link>
          </Button>
        </Card>
      ) : (
        <div className="pixel-paper min-h-[24rem] px-2 py-4 sm:px-4">
          <PageEditor
            data={editor}
            blocks={page.blocks}
            markdown={page.body}
            externalStamp={page.externalStamp}
            onSave={(v) => {
              latest.current = v;
              setStatus("saving");
              clearTimeout(timer.current);
              timer.current = setTimeout(() => void flush(), 800);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ModeSwitch({ value, onChange }: { value: ReaderMode; onChange: (m: ReaderMode) => void }) {
  const t = useT();
  return (
    <div className="flex shrink-0 border-2 border-frame text-[11px]">
      {(["always", "when_needed", "never"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => m !== value && onChange(m)}
          className={cn("px-1.5 py-0.5", m === value ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground")}
        >
          {t(`context.mode.${m}`)}
        </button>
      ))}
    </div>
  );
}

/** Who reads a page, and how (K1's panel; the inspector uses the same setting). */
export function ReadersPanel({ businessId, pageId, mates, readers }: { businessId: string; pageId: string; mates: Mate[]; readers: ReaderView[] }) {
  const t = useT();
  const [, start] = useTransition();
  return (
    <Card className="space-y-2 p-3">
      <h2 className="text-sm font-semibold">{t("context.panel.readers")}</h2>
      <p className="text-[11px] text-muted-foreground">{t("context.panel.readersHelp")}</p>
      <ul className="space-y-1.5">
        {mates.map((m) => (
          <li key={m.id} className="flex items-center gap-2">
            <Avatar seed={m.id} name={m.name} color={m.color} size={20} />
            <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
            <ModeSwitch value={readers.find((r) => r.teammateId === m.id)?.mode ?? "when_needed"} onChange={(mode) => start(() => setReaderAction(businessId, pageId, m.id, mode))} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UsagePanel({ usage, mates }: { usage: UsageView; mates: Mate[] }) {
  const t = useT();
  const tn = useTn();
  return (
    <Card className="space-y-2 p-3">
      <h2 className="text-sm font-semibold">{t("context.panel.usage")}</h2>
      {usage.runs === 0 ? (
        <p className="text-xs text-muted-foreground">{t("context.usage.none")}</p>
      ) : (
        <>
          <p className="text-sm">
            {tn("context.usage.runs", usage.runs)}
            {usage.fetched > 0 && <span className="text-muted-foreground"> · {t("context.usage.fetched", { count: usage.fetched })}</span>}
          </p>
          <ul className="space-y-1">
            {usage.byTeammate.map((u) => {
              const m = mates.find((x) => x.id === u.id);
              return (
                <li key={u.id} className="flex items-center gap-2 text-xs">
                  <span className="w-20 truncate">{m?.name ?? "?"}</span>
                  <span className="h-2 bg-primary" style={{ width: `${Math.max(6, (u.count / usage.runs) * 100)}%` }} />
                  <span className="text-muted-foreground">{u.count}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/** A suggestion as insertions and deletions, with who, why and where it came from. */
export function SuggestionDiff({ s }: { s: SuggestionView }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
      {s.diff.map((l, i) =>
        l.op === "skip" ? (
          <div key={i} className="text-muted-foreground">
            ⋯
          </div>
        ) : (
          <div key={i} className={cn(l.op === "add" && "bg-emerald-500/20 text-emerald-200", l.op === "del" && "bg-red-500/20 text-red-200 line-through", l.op === "same" && "text-muted-foreground")}>
            {l.op === "add" ? "+ " : l.op === "del" ? "− " : "  "}
            {l.text || " "}
          </div>
        ),
      )}
    </pre>
  );
}

function SuggestionsPanel({ businessId, suggestions, mates, otherPending }: { businessId: string; suggestions: SuggestionView[]; mates: Mate[]; otherPending: { pageId: string; title: string; count: number }[] }) {
  const t = useT();
  return (
    <Card className="space-y-3 p-3">
      <h2 className="text-sm font-semibold">{t("context.panel.suggestions")}</h2>
      {suggestions.length === 0 ? <p className="text-xs text-muted-foreground">{t("context.panel.noSuggestions")}</p> : suggestions.map((s) => <SuggestionItem key={s.id} businessId={businessId} s={s} mate={mates.find((m) => m.id === s.authorId)} />)}
      {otherPending.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="pb-1 text-[11px] text-muted-foreground">{t("context.allSuggestions")}</p>
          <ul className="space-y-0.5">
            {otherPending.map((o) => (
              <li key={o.pageId}>
                <Link href={`/b/${businessId}/context?page=${o.pageId}`} className="flex justify-between gap-2 text-xs hover:text-foreground">
                  <span className="truncate">{o.title}</span>
                  <span className="text-primary">{o.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function SuggestionItem({ businessId, s, mate }: { businessId: string; s: SuggestionView; mate?: Mate }) {
  const t = useT();
  const lang = useLang();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.body);
  const [pending, start] = useTransition();
  const decide = (accept: boolean, body?: string) => start(async () => void (await decideSuggestionAction(businessId, s.id, accept, body)));
  return (
    <div className="space-y-2 border-t border-border pt-2 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex items-center gap-2 text-xs">
        {mate && <Avatar seed={mate.id} name={mate.name} color={mate.color} size={18} />}
        <span className="font-medium">{t("context.suggest.from", { name: s.author ?? "?" })}</span>
        {s.fromChat && <Badge tone="violet">{t("context.suggest.manager")}</Badge>}
        <span className="ml-auto text-muted-foreground">{new Date(s.createdAt).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" })}</span>
      </div>
      {s.kind === "new_page" && <p className="text-xs font-medium">{t("context.suggest.newPage", { title: s.title ?? "", section: s.section ? t(`context.section.${s.section}`) : "" })}</p>}
      {s.reason && <p className="text-xs">{s.reason}</p>}
      {s.source && (
        <p className="text-[11px] italic text-muted-foreground">
          {t("context.suggest.source")}: {s.source}
        </p>
      )}
      {s.changedSince && <p className="text-[11px] text-amber-400">{t("context.suggest.changedSince")}</p>}
      {editing ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className="w-full border border-border bg-background p-2 font-mono text-[11px]" /> : <SuggestionDiff s={s} />}
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" disabled={pending} onClick={() => decide(true, editing ? text : undefined)}>
          {t("context.accept")}
        </Button>
        <Button size="xs" variant="secondary" disabled={pending} onClick={() => setEditing(!editing)}>
          {editing ? t("context.cancel") : t("context.edit")}
        </Button>
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => decide(false)}>
          {t("context.reject")}
        </Button>
      </div>
    </div>
  );
}
