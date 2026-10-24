"use client";

import { Plus, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  linkObjects,
  loadObjectPanel,
  restoreObjectVersion,
  searchLinkTargets,
  unlinkObjects,
  type ObjectPanelData,
  type ObjectPanelLink,
} from "@/app/b/[id]/actions";
import { fullTime, relativeTime } from "@/app/b/[id]/deliverables/format";
import { useLang, useT } from "@/components/i18n";
import { Button, cn, IconButton, Input, Skeleton } from "@/components/kit";
import { ObjectTypeIcon } from "@/components/object-type-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { actionLabel, actorLabel, typeLabel } from "@/components/workspace-labels";
import type { ObjectRef, RefInfo } from "@/lib/links";

/**
 * The shared panel under any doc, deliverable, asset or contact: "Links" (what it links
 * to, what links to it, add and remove links) and "History" (each change, who made it,
 * and "Restore this version"). Areas mount it in their side peek with the object's ref.
 * Contract for other areas: `<ObjectPanel businessId objectRef />`, nothing else.
 */
export function ObjectPanel({ businessId, objectRef }: { businessId: string; objectRef: ObjectRef }) {
  const t = useT();
  const [data, setData] = useState<ObjectPanelData | null>(null);
  const key = `${objectRef.type}:${objectRef.id}`;

  const reload = useCallback(
    () => loadObjectPanel(businessId, objectRef).then(setData),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [businessId, key],
  );

  useEffect(() => {
    let live = true;
    loadObjectPanel(businessId, objectRef).then((d) => live && setData(d));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, key]);

  return (
    <Tabs defaultValue="links" className="gap-3">
      <TabsList variant="line">
        <TabsTrigger value="links">
          {t("workspace.panel.links")}
          {data && data.links.length > 0 && <span className="text-xs font-normal text-tertiary tabular-nums">{data.links.length}</span>}
        </TabsTrigger>
        <TabsTrigger value="history">{t("workspace.panel.history")}</TabsTrigger>
      </TabsList>
      <TabsContent value="links">
        {data ? <LinksTab businessId={businessId} objectRef={objectRef} links={data.links} reload={reload} /> : <PanelSkeleton />}
      </TabsContent>
      <TabsContent value="history">
        {data ? <HistoryTab businessId={businessId} history={data.history} reload={reload} /> : <PanelSkeleton />}
      </TabsContent>
    </Tabs>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2" aria-busy>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
    </div>
  );
}

function LinksTab({ businessId, objectRef, links, reload }: { businessId: string; objectRef: ObjectRef; links: ObjectPanelLink[]; reload: () => Promise<void> }) {
  const t = useT();
  const [pending, start] = useTransition();
  const out = links.filter((l) => l.direction === "out");
  const back = links.filter((l) => l.direction === "in");

  const remove = (l: ObjectPanelLink) =>
    start(async () => {
      const r = await unlinkObjects(businessId, objectRef, { type: l.type, id: l.id }, l.direction);
      if ("error" in r) toast.error(t("workspace.panel.failed"));
      await reload();
    });

  const add = (to: RefInfo) =>
    start(async () => {
      const r = await linkObjects(businessId, objectRef, { type: to.type, id: to.id });
      if ("error" in r) toast.error(t("workspace.panel.failed"));
      await reload();
    });

  return (
    <div className={cn("space-y-4", pending && "opacity-70")}>
      {links.length === 0 && <p className="text-[13px] text-tertiary">{t("workspace.panel.noLinks")}</p>}
      {out.length > 0 && <LinkGroup title={t("workspace.panel.linksTo")} links={out} onRemove={remove} />}
      {back.length > 0 && <LinkGroup title={t("workspace.panel.linkedFrom")} links={back} onRemove={remove} />}
      <LinkPicker businessId={businessId} objectRef={objectRef} onPick={add} />
    </div>
  );
}

function LinkGroup({ title, links, onRemove }: { title: string; links: ObjectPanelLink[]; onRemove: (l: ObjectPanelLink) => void }) {
  const t = useT();
  return (
    <div>
      <p className="mb-1 text-xs text-tertiary">{title}</p>
      <ul className="space-y-0.5">
        {links.map((l) => (
          <li key={l.linkId} className="group flex min-h-7 items-center gap-2 rounded-md px-1 hover:bg-hover/60">
            <ObjectTypeIcon type={l.type} />
            <Link
              href={l.href}
              title={typeLabel(t, l.type)}
              className={cn("min-w-0 flex-1 truncate text-[13px] text-foreground hover:underline", l.deleted && "text-tertiary line-through")}
            >
              {l.title}
            </Link>
            {l.deleted && <span className="shrink-0 text-xs text-tertiary">{t("workspace.panel.inTrash")}</span>}
            <IconButton label={t("workspace.panel.removeLink")} size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onRemove(l)}>
              <X />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Add link": a search over docs, pages, library files and contacts. */
function LinkPicker({ businessId, objectRef, onPick }: { businessId: string; objectRef: ObjectRef; onPick: (r: RefInfo) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RefInfo[] | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      searchLinkTargets(businessId, query, objectRef).then((r) => live && setResults(r));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, businessId]);

  const short = q.trim().length < 2;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQ("");
          setResults(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Plus />
          {t("workspace.panel.addLink")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("workspace.panel.searchPlaceholder")} aria-label={t("workspace.panel.addLink")} />
        <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
          {short ? (
            <li className="px-2 py-1.5 text-xs text-tertiary">{t("workspace.panel.typeToSearch")}</li>
          ) : results && results.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-tertiary">{t("workspace.panel.noMatches")}</li>
          ) : (
            (results ?? []).map((r) => (
              <li key={`${r.type}:${r.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(r);
                    setOpen(false);
                    setQ("");
                    setResults(null);
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover"
                >
                  <ObjectTypeIcon type={r.type} />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="shrink-0 text-xs text-tertiary">{typeLabel(t, r.type)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function HistoryTab({ businessId, history, reload }: { businessId: string; history: ObjectPanelData["history"]; reload: () => Promise<void> }) {
  const t = useT();
  const lang = useLang();
  const [pending, start] = useTransition();
  if (history.length === 0) return <p className="text-[13px] text-tertiary">{t("workspace.panel.noHistory")}</p>;
  return (
    <ol className={cn("space-y-0.5", pending && "opacity-70")}>
      {history.map((h) => (
        <li key={h.id} className="group flex min-h-8 items-center gap-2 rounded-md px-1 hover:bg-hover/60">
          <span aria-hidden className="mx-1 size-1.5 shrink-0 rounded-full bg-border-strong" />
          <span className="min-w-0 flex-1 truncate text-[13px]">
            <span className="text-foreground">{actionLabel(t, h.action)}</span>
            <span className="text-muted-foreground"> · {actorLabel(t, h.actor)}</span>
          </span>
          <time className="shrink-0 text-xs text-tertiary" dateTime={new Date(h.createdAt).toISOString()} title={fullTime(new Date(h.createdAt), lang)}>
            {relativeTime(new Date(h.createdAt), lang)}
          </time>
          {h.canRestore && (
            <IconButton
              label={t("workspace.panel.restoreVersion")}
              size="icon-xs"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() =>
                start(async () => {
                  const r = await restoreObjectVersion(businessId, h.id);
                  if ("error" in r) toast.error(t("workspace.panel.failed"));
                  else toast.success(t("workspace.panel.restored"));
                  await reload();
                })
              }
            >
              <RotateCcw />
            </IconButton>
          )}
        </li>
      ))}
    </ol>
  );
}
