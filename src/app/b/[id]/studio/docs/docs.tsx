"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FileTextIcon, ImageIcon, PlusIcon, VideoIcon, XIcon } from "lucide-react";
import { Badge, Button, Card, cn, Input, Textarea } from "@/components/kit";
import { Markdown } from "@/components/markdown";
import type { Deliverable, DeliverableStatus } from "@/db/schema";
import type { MediaKind } from "@/lib/media-types";
import { deleteDoc, saveDoc } from "../actions";
import { fileUrl } from "../_components/edits-list";
import { PlanTask } from "../_components/plan-task";

const KINDS = ["note", "brief", "plan", "script", "social_post", "blog_post", "email", "ad_copy", "report", "faq", "price_list"];
const STATUS: DeliverableStatus[] = ["draft", "approved", "published", "rejected"];
const TONE = { draft: "neutral", approved: "green", published: "blue", rejected: "red" } as const;
const label = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Mate = { id: string; name: string; title: string; kind: string };
type MediaOption = { path: string; name: string; kind: MediaKind };

/** Write briefs, notes and scripts, and edit the team's drafts; hand any doc to a teammate for later. */
export function Docs({ businessId, docs, docId, teammates, media }: { businessId: string; docs: Deliverable[]; docId?: string; teammates: Mate[]; media: MediaOption[] }) {
  const [q, setQ] = useState("");
  const [mine, setMine] = useState<"all" | "mine" | "team">("all");
  const doc = docs.find((d) => d.id === docId);
  const names = useMemo(() => new Map(teammates.map((t) => [t.id, t.name])), [teammates]);
  const shown = docs.filter((d) => {
    if (mine === "mine" && d.teammateId) return false;
    if (mine === "team" && !d.teammateId) return false;
    const s = q.trim().toLowerCase();
    return !s || `${d.title} ${d.kind} ${d.content}`.toLowerCase().includes(s);
  });
  const base = `/b/${businessId}/studio/docs`;

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-2">
        <Button asChild className="w-full">
          <Link href={base}>
            <PlusIcon /> New doc
          </Link>
        </Button>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search docs…" className="h-8" />
        <div className="flex gap-1 text-xs">
          {(["all", "mine", "team"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMine(m)} className={cn("flex-1 border-2 px-1 py-0.5", mine === m ? "border-primary bg-primary/15" : "border-frame")}>
              {m === "all" ? "All" : m === "mine" ? "Yours" : "Team's"}
            </button>
          ))}
        </div>
        <Card className="max-h-[65vh] divide-y divide-border overflow-y-auto p-0">
          {shown.length === 0 && <p className="p-3 text-xs text-muted-foreground">No docs yet.</p>}
          {shown.map((d) => (
            <Link key={d.id} href={`${base}?doc=${d.id}`} className={cn("block px-3 py-2 hover:bg-muted", d.id === docId && "bg-muted")}>
              <span className="flex items-center gap-2">
                <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{d.title}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge tone={TONE[d.status]}>{d.status}</Badge>
                {label(d.kind)} · {d.teammateId ? (names.get(d.teammateId) ?? "Team") : "You"}
              </span>
            </Link>
          ))}
        </Card>
      </aside>
      <Editor key={doc?.id ?? "new"} businessId={businessId} doc={doc} author={doc?.teammateId ? names.get(doc.teammateId) : undefined} teammates={teammates} media={media} />
    </div>
  );
}

function Editor({ businessId, doc, author, teammates, media }: { businessId: string; doc?: Deliverable; author?: string; teammates: Mate[]; media: MediaOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(doc?.title ?? "");
  const [kind, setKind] = useState(doc?.kind ?? "brief");
  const [channel, setChannel] = useState(doc?.channel ?? "");
  const [content, setContent] = useState(doc?.content ?? "");
  const [status, setStatus] = useState<DeliverableStatus>(doc?.status ?? "draft");
  const [attachments, setAttachments] = useState<string[]>(doc?.attachments ?? []);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const kinds = KINDS.includes(kind) ? KINDS : [kind, ...KINDS];
  const dirty =
    title !== (doc?.title ?? "") ||
    kind !== (doc?.kind ?? "brief") ||
    channel !== (doc?.channel ?? "") ||
    content !== (doc?.content ?? "") ||
    status !== (doc?.status ?? "draft") ||
    attachments.join() !== (doc?.attachments ?? []).join();

  const save = () =>
    start(async () => {
      const r = await saveDoc(businessId, { id: doc?.id, title, kind, channel, content, status, attachments });
      if ("error" in r) return setMsg({ error: r.error });
      setMsg({ ok: "Saved" });
      if (!doc) router.replace(`/b/${businessId}/studio/docs?doc=${r.id}`);
    });

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const handOver = `Work from this ${label(kind).toLowerCase()} (saved as "${title}"):\n\n${content}`.slice(0, 20000);

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <Card className="min-w-0 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Brief: payday weekend promo" className="min-w-60 flex-1 text-base font-semibold" />
          {author && <span className="text-xs text-muted-foreground">by {author}</span>}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2">
            {kinds.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
          <Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Channel (instagram, website…)" className="h-8 w-52" />
          <select value={status} onChange={(e) => setStatus(e.target.value as DeliverableStatus)} className="h-8 rounded-md border border-border bg-background px-2">
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
          <span className="ml-auto flex gap-1">
            {(["write", "preview"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cn("border-2 px-2 py-0.5 text-xs", tab === t ? "border-primary bg-primary/15" : "border-frame")}>
                {t === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </span>
        </div>
        {tab === "write" ? (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            placeholder={"Write in plain text or Markdown.\n\n# Goal\nWhat this should achieve…\n\n## Details\n- Prices, dates, who it's for…"}
            className="min-h-[50vh] font-mono text-sm leading-relaxed"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                save();
              }
            }}
          />
        ) : (
          <div className="min-h-[50vh] rounded-md border border-border p-4">{content.trim() ? <Markdown>{content}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}</div>
        )}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Attached files
            <button type="button" onClick={() => setPicking(!picking)} className="text-primary hover:underline">
              {picking ? "Done" : "+ Add from library"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {attachments.map((p) => (
              <span key={p} className="relative">
                <Thumb businessId={businessId} path={p} />
                <button type="button" onClick={() => setAttachments((a) => a.filter((x) => x !== p))} className="absolute -top-1.5 -right-1.5 rounded-full bg-red-500 p-0.5 text-white" aria-label="Remove">
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
            {!attachments.length && !picking && <span className="text-xs text-muted-foreground">None</span>}
          </div>
          {picking && (
            <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 overflow-y-auto rounded-md border border-border p-2">
              {media.length === 0 && <p className="col-span-full text-xs text-muted-foreground">Your library is empty.</p>}
              {media.map((m) => (
                <button
                  key={m.path}
                  type="button"
                  title={m.name}
                  onClick={() => setAttachments((a) => (a.includes(m.path) ? a.filter((x) => x !== m.path) : [...a, m.path]))}
                  className={cn("outline-offset-2", attachments.includes(m.path) && "outline-2 outline-primary")}
                >
                  <Thumb businessId={businessId} path={m.path} kind={m.kind} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button onClick={save} disabled={pending || !dirty || !title.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <span className="text-xs text-muted-foreground">{words} words · Ctrl/⌘+S saves</span>
          {msg?.ok && !dirty && <span className="text-xs text-emerald-600 dark:text-emerald-400">{msg.ok}</span>}
          {msg?.error && <span className="text-xs text-red-600 dark:text-red-400">{msg.error}</span>}
          {doc && (
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete "${doc.title}"?`)) return;
                start(async () => {
                  await deleteDoc(businessId, doc.id);
                  router.replace(`/b/${businessId}/studio/docs`);
                });
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </Card>
      <aside className="space-y-3">
        <Card className="space-y-2 p-3 text-sm text-muted-foreground">
          <div className="font-pixel text-foreground">Prepare for later</div>
          <p>Write the brief now; hand it to a teammate and it waits in the queue until the team has usage again.</p>
          <p>Saved docs are also in the team&apos;s Work list and as a file in work/.</p>
        </Card>
        {doc && content.trim() && (
          <Card className="p-3">
            <PlanTask
              key={`${doc.id}:${doc.title}:${doc.content.length}`}
              businessId={businessId}
              teammates={teammates.filter((t) => t.kind === "ai")}
              attachments={attachments}
              defaultText={handOver}
            />
          </Card>
        )}
      </aside>
    </div>
  );
}

function Thumb({ businessId, path, kind }: { businessId: string; path: string; kind?: MediaKind }) {
  const k = kind ?? (/\.(png|jpe?g|webp|gif|svg)$/i.test(path) ? "image" : /\.(mp4|mov|m4v|webm)$/i.test(path) ? "video" : "file");
  return (
    <span className="flex size-16 items-center justify-center overflow-hidden bg-muted">
      {k === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
        <img src={fileUrl(businessId, path)} alt="" className="size-full object-cover" />
      ) : k === "video" ? (
        <VideoIcon className="size-6 text-muted-foreground" />
      ) : (
        <ImageIcon className="size-6 text-muted-foreground" />
      )}
    </span>
  );
}
