import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import {
  BracesIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  MusicIcon,
  SearchIcon,
  TableIcon,
  VideoIcon,
} from "lucide-react";
import { db, schema } from "@/db";
import { LiveRefresh } from "@/components/live";
import { Badge, Button, Card, Input, PageHeader, PageSkeleton } from "@/components/kit";
import { FileMarkdown } from "@/components/markdown";
import { ROOTS, cleanRel, fileStat, fileType, listDir, readText, searchFiles, type Entry, type FileType } from "@/lib/browse";
import { getBusiness } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * Files: browse everything the team made and keeps in the business folder (work,
 * media library, teammates' memory and drafts). Folders on the left; a gallery and
 * list, or a preview (markdown, images, video, CSV, JSON), on the right.
 */
export default function FilesPage(props: PageProps<"/b/[id]/files">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

const LIVE = ["deliverable_saved", "image_rendered", "video_rendered", "asset_downloaded", "human_replied", "task_done"];

const fileUrl = (businessId: string, rel: string, download = false) =>
  `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}${download ? "?download=1" : ""}`;
const href = (businessId: string, rel: string) => `/b/${businessId}/files${rel ? `?path=${encodeURIComponent(rel)}` : ""}`;

function size(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
const when = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const ICONS: Record<FileType | "dir", typeof FileIcon> = {
  dir: FolderIcon,
  markdown: FileTextIcon,
  image: ImageIcon,
  video: VideoIcon,
  audio: MusicIcon,
  pdf: FileTextIcon,
  csv: TableIcon,
  json: BracesIcon,
  text: FileTextIcon,
  other: FileIcon,
};

async function Content({ params, searchParams }: PageProps<"/b/[id]/files">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const raw = typeof sp.path === "string" ? sp.path : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const rel = cleanRel(raw);
  if (rel === null) notFound();
  const stat = rel ? fileStat(rel) : { isDir: true, size: 0, mtime: new Date() };
  if (!stat) notFound();
  // Teammate folders are slugs ("sinta"); show their names.
  const names = new Map(
    db
      .select({ dir: schema.teammates.workspaceDir, name: schema.teammates.name, title: schema.teammates.title })
      .from(schema.teammates)
      .where(eq(schema.teammates.businessId, id))
      .all()
      .filter((t) => t.dir)
      .map((t) => [t.dir!.replace(/^.*?(teammates\/)/, "$1"), `${t.name} · ${t.title}`]),
  );
  const folder = stat.isDir ? rel : rel.split("/").slice(0, -1).join("/");

  return (
    <div>
      <LiveRefresh businessId={id} types={LIVE} />
      <PageHeader title="Files" subtitle="Everything your team made and keeps: work, the media library, and each teammate's memory and drafts." />
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="space-y-3">
          <form action={`/b/${id}/files`} className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Search files…" className="pl-8" />
          </form>
          <Card className="p-2">
            <nav className="text-sm">
              <Link href={href(id, "")} className={cn("flex items-center gap-2 px-2 py-1 hover:bg-muted", !rel && !q && "bg-muted font-medium")}>
                <FolderOpenIcon className="size-4 text-primary" /> All files
              </Link>
              {ROOTS.map((r) => (
                <Tree key={r.key} businessId={id} rel={r.key} label={r.label} open={folder} names={names} depth={0} />
              ))}
            </nav>
          </Card>
        </aside>

        <main className="min-w-0 space-y-4">
          {q ? (
            <SearchResults businessId={id} q={q} names={names} />
          ) : (
            <>
              <Breadcrumbs businessId={id} rel={rel} names={names} />
              {stat.isDir ? <FolderView businessId={id} rel={rel} names={names} /> : <FileView businessId={id} rel={rel} size={stat.size} mtime={stat.mtime} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** Folders only; the folder you're in (and its parents) are expanded. */
function Tree({ businessId, rel, label, open, names, depth }: { businessId: string; rel: string; label: string; open: string; names: Map<string, string>; depth: number }) {
  const expanded = open === rel || open.startsWith(`${rel}/`);
  const here = open === rel;
  const subfolders = expanded ? (listDir(rel) ?? []).filter((e) => e.isDir) : [];
  const Icon = expanded ? FolderOpenIcon : FolderIcon;
  return (
    <div>
      <Link
        href={href(businessId, rel)}
        className={cn("flex items-center gap-2 py-1 pr-2 hover:bg-muted", here && "bg-muted font-medium")}
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        title={rel}
      >
        <Icon className="size-4 shrink-0 text-primary" />
        <span className="truncate">{label}</span>
      </Link>
      {subfolders.map((f) => (
        <Tree key={f.rel} businessId={businessId} rel={f.rel} label={names.get(f.rel)?.split(" · ")[0] ?? f.name} open={open} names={names} depth={depth + 1} />
      ))}
    </div>
  );
}

function Breadcrumbs({ businessId, rel, names }: { businessId: string; rel: string; names: Map<string, string> }) {
  const parts = rel ? rel.split("/") : [];
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <Link href={href(businessId, "")} className="text-muted-foreground hover:text-foreground">
        Files
      </Link>
      {parts.map((p, i) => {
        const r = parts.slice(0, i + 1).join("/");
        const label = i === 0 ? (ROOTS.find((x) => x.key === p)?.label ?? p) : (names.get(r)?.split(" · ")[0] ?? p);
        return (
          <span key={r} className="flex items-center gap-1">
            <span className="text-muted-foreground">/</span>
            {i === parts.length - 1 ? (
              <span className="font-medium">{label}</span>
            ) : (
              <Link href={href(businessId, r)} className="text-muted-foreground hover:text-foreground">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}

function FolderView({ businessId, rel, names }: { businessId: string; rel: string; names: Map<string, string> }) {
  const entries = listDir(rel) ?? [];
  if (!rel) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {ROOTS.map((r) => {
          const e = entries.find((x) => x.rel === r.key);
          return (
            <Link key={r.key} href={href(businessId, r.key)}>
              <Card className="h-full space-y-1 p-4 transition hover:-translate-y-0.5">
                <div className="flex items-center gap-2">
                  <FolderIcon className="size-5 text-primary" />
                  <span className="font-pixel text-lg">{r.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{r.hint}</p>
                {e && <Badge>{e.children} items</Badge>}
              </Card>
            </Link>
          );
        })}
      </div>
    );
  }
  if (!entries.length) return <Card className="p-6 text-sm text-muted-foreground">This folder is empty.</Card>;
  const visual = entries.filter((e) => e.type === "image" || e.type === "video");
  const rest = entries.filter((e) => e.type !== "image" && e.type !== "video");
  return (
    <div className="space-y-4">
      {visual.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {visual.map((e, i) => (
            <Link key={e.rel} href={href(businessId, e.rel)} className="pixel-frame group relative m-[3px] block overflow-hidden bg-muted" title={e.name}>
              <div className="aspect-[4/5]">
                {e.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
                  <img src={fileUrl(businessId, e.rel)} alt={e.name} loading={i < 30 ? "eager" : "lazy"} className="size-full object-cover transition group-hover:scale-105" />
                ) : (
                  <video src={`${fileUrl(businessId, e.rel)}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" />
                )}
              </div>
              <div className="flex items-center gap-1 bg-ink/85 px-1.5 py-1 text-[11px] text-parchment">
                {e.type === "video" ? <VideoIcon className="size-3 shrink-0" /> : <ImageIcon className="size-3 shrink-0" />}
                <span className="truncate">{e.name}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {rest.length > 0 && <EntryList businessId={businessId} entries={rest} names={names} />}
    </div>
  );
}

function EntryList({ businessId, entries, names, showPath }: { businessId: string; entries: Entry[]; names: Map<string, string>; showPath?: boolean }) {
  return (
    <Card className="divide-y divide-border p-0">
      {entries.map((e) => {
        const Icon = ICONS[e.type];
        const label = e.isDir ? (names.get(e.rel) ?? e.name) : (e.title ?? e.name);
        return (
          <Link key={e.rel} href={href(businessId, e.rel)} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
            <Icon className={cn("size-4 shrink-0", e.isDir ? "text-primary" : "text-muted-foreground")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{label}</span>
              {(showPath || (e.title && e.title !== e.name)) && (
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{showPath ? e.rel : e.name}</span>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {e.isDir ? `${e.children ?? 0} items` : `${size(e.size)} · ${when(e.mtime)}`}
            </span>
          </Link>
        );
      })}
    </Card>
  );
}

function SearchResults({ businessId, q, names }: { businessId: string; q: string; names: Map<string, string> }) {
  const found = searchFiles(q);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>
          {found.length} file{found.length === 1 ? "" : "s"} matching <span className="font-medium">“{q}”</span>
        </span>
        <Link href={href(businessId, "")} className="text-muted-foreground hover:text-foreground">
          Clear search
        </Link>
      </div>
      {found.length > 0 && <EntryList businessId={businessId} entries={found} names={names} showPath />}
    </div>
  );
}

/** "---\nkey: value\n---\nbody" → [{key, value}], body */
function frontMatter(text: string) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: [] as [string, string][], body: text };
  const meta = m[1]
    .split("\n")
    .map((l) => /^([\w-]+):\s*(.*)$/.exec(l))
    .filter((x): x is RegExpExecArray => !!x)
    .map(([, k, v]): [string, string] => [k, v.replace(/^"(.*)"$/, "$1")]);
  return { meta, body: text.slice(m[0].length) };
}

function parseCsv(text: string, maxRows = 300) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

function FileView({ businessId, rel, size: bytes, mtime }: { businessId: string; rel: string; size: number; mtime: Date }) {
  const type = fileType(rel);
  const name = rel.split("/").pop() ?? rel;
  const url = fileUrl(businessId, rel);
  const siblings = (listDir(rel.split("/").slice(0, -1).join("/")) ?? []).filter((e) => !e.isDir);
  const i = siblings.findIndex((e) => e.rel === rel);
  const newer = i > 0 ? siblings[i - 1] : undefined;
  const older = i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : undefined;
  const text = ["markdown", "csv", "json", "text"].includes(type) ? readText(rel) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-pixel text-lg" title={name}>
          {name}
        </h2>
        <span className="text-xs text-muted-foreground">
          {size(bytes)} · {when(mtime)}
        </span>
        {newer && (
          <Button asChild variant="secondary" size="sm">
            <Link href={href(businessId, newer.rel)} title={newer.name}>
              ← Newer
            </Link>
          </Button>
        )}
        {older && (
          <Button asChild variant="secondary" size="sm">
            <Link href={href(businessId, older.rel)} title={older.name}>
              Older →
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary" size="sm">
          <a href={fileUrl(businessId, rel, true)}>
            <DownloadIcon /> Download
          </a>
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        {type === "image" && (
          <div className="flex justify-center bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- local files from the business folder */}
            <img src={url} alt={name} className="max-h-[75vh] max-w-full object-contain" />
          </div>
        )}
        {type === "video" && <video src={url} controls playsInline className="max-h-[75vh] w-full bg-black" />}
        {type === "audio" && (
          <div className="flex flex-col items-center gap-3 p-8">
            <MusicIcon className="size-10 text-muted-foreground" />
            <audio src={url} controls />
          </div>
        )}
        {type === "pdf" && <iframe src={url} title={name} className="h-[75vh] w-full bg-white" />}
        {type === "markdown" && text && <MarkdownPreview businessId={businessId} rel={rel} text={text.text} />}
        {type === "csv" && text && <CsvPreview text={text.text} />}
        {type === "json" && text && <pre className="max-h-[75vh] overflow-auto p-4 font-mono text-xs leading-relaxed">{prettyJson(text.text)}</pre>}
        {type === "text" && text && <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed">{text.text}</pre>}
        {type === "other" && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No preview for this kind of file. <a href={fileUrl(businessId, rel, true)} className="underline">Download it</a> to open it.
          </div>
        )}
        {text?.truncated && <p className="border-t border-border p-2 text-center text-xs text-muted-foreground">Showing the first 1 MB. Download for the rest.</p>}
      </Card>
    </div>
  );
}

function MarkdownPreview({ businessId, rel, text }: { businessId: string; rel: string; text: string }) {
  const { meta, body } = frontMatter(text);
  return (
    <div>
      {meta.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border bg-muted/50 px-5 py-3 text-xs">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="max-h-[75vh] overflow-auto px-5 py-4">
        <FileMarkdown businessId={businessId} path={rel}>
          {body}
        </FileMarkdown>
      </div>
    </div>
  );
}

function CsvPreview({ text }: { text: string }) {
  const rows = parseCsv(text);
  const [head, ...body] = rows;
  if (!head) return <p className="p-4 text-sm text-muted-foreground">Empty file.</p>;
  return (
    <div className="max-h-[75vh] overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-card">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="odd:bg-muted/40">
              {r.map((c, j) => (
                <td key={j} className="max-w-72 truncate px-2 py-1" title={c}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= 300 && <p className="p-2 text-center text-xs text-muted-foreground">Showing the first 300 rows.</p>}
    </div>
  );
}

function prettyJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
