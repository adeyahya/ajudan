import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { eq } from "drizzle-orm";
import {
  BracesIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  HashIcon,
  ImageIcon,
  InfoIcon,
  LayersIcon,
  MusicIcon,
  SearchIcon,
  SearchXIcon,
  TableIcon,
  TypeIcon,
  VideoIcon,
} from "lucide-react";
import { db, schema } from "@/db";
import { LiveRefresh } from "@/components/live";
import { SetBreadcrumb, TopBarActions, type Crumb } from "@/components/breadcrumb";
import { DocLayoutButtons } from "@/components/doc-layout";
import { DataTable, Gallery, GalleryTile, type Column } from "@/components/data-table";
import { Button, CardGridSkeleton, EmptyState, IconButton, Input, PageBody, PageHeader, PropertyList, Skeleton, cn } from "@/components/kit";
import { FileMarkdown } from "@/components/markdown";
import { ROOTS, cleanRel, fileStat, fileType, listDir, listFolders, readText, searchFiles, withDetails, type Entry, type FileType } from "@/lib/browse";
import { getBusiness } from "@/lib/data";
import { dateLocale, t, tn, uiLang, type MessageKey, type UiLang } from "@/lib/i18n";

/**
 * Files: browse everything the team made and keeps in the business folder (work,
 * media library, teammates' memory and drafts). A folder tree on the left; on the right
 * a gallery + table for a folder, or a preview (markdown, images, video, CSV, JSON).
 * The path shows as breadcrumbs in the top bar.
 */
export default function FilesPage(props: PageProps<"/b/[id]/files">) {
  return (
    <Suspense
      fallback={
        <PageBody width="wide">
          <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="hidden space-y-2 lg:block">
              <Skeleton className="h-7 w-full" />
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-5" style={{ width: `${70 - i * 8}%` }} />
              ))}
            </div>
            <div>
              <Skeleton className="h-[34px] w-40 rounded-md" />
              <CardGridSkeleton count={8} className="mt-10" />
            </div>
          </div>
        </PageBody>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}

const LIVE = ["deliverable_saved", "image_rendered", "video_rendered", "asset_downloaded", "human_replied", "task_done"];

const fileUrl = (businessId: string, rel: string, download = false) =>
  `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}${download ? "?download=1" : ""}`;
const href = (businessId: string, rel: string, page = 1) => {
  const p = new URLSearchParams();
  if (rel) p.set("path", rel);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return `/b/${businessId}/files${qs ? `?${qs}` : ""}`;
};

/** Entries per folder page: a big folder is listed (stat) whole but titled and rendered a page at a time. */
const PAGE_SIZE = 200;

function size(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
const when = (d: Date, lang: UiLang) => d.toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short" });

/** The top folders (src/lib/browse.ts ROOTS), named in the UI language. */
const rootLabel = (key: string, lang: UiLang) => t(lang, `files.root.${key}` as MessageKey);
const rootHint = (key: string, lang: UiLang) => t(lang, `files.root.${key}.hint` as MessageKey);

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

type Names = Map<string, string>;

/** A path segment's label: root folders translated, teammate folders by name. */
function segLabel(rel: string, names: Names, lang: UiLang) {
  const parts = rel.split("/");
  if (parts.length === 1 && ROOTS.some((r) => r.key === rel)) return rootLabel(rel, lang);
  return names.get(rel)?.split(" · ")[0] ?? parts[parts.length - 1];
}

async function Content({ params, searchParams }: PageProps<"/b/[id]/files">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const lang = uiLang(biz.language);
  const raw = typeof sp.path === "string" ? sp.path : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const pageNo = Math.max(1, Number(sp.page) || 1);
  const rel = cleanRel(raw);
  if (rel === null) notFound();
  const stat = rel ? fileStat(rel) : { isDir: true, size: 0, mtime: new Date() };
  if (!stat) notFound();
  // Teammate folders are slugs ("sinta"); show their names.
  const names: Names = new Map(
    db
      .select({ dir: schema.teammates.workspaceDir, name: schema.teammates.name, title: schema.teammates.title })
      .from(schema.teammates)
      .where(eq(schema.teammates.businessId, id))
      .all()
      .filter((t) => t.dir)
      .map((t) => [t.dir!.replace(/^.*?(teammates\/)/, "$1"), `${t.name} · ${t.title}`]),
  );
  const folder = stat.isDir ? rel : rel.split("/").slice(0, -1).join("/");
  const parts = rel ? rel.split("/") : [];
  const crumbs: Crumb[] = q
    ? [{ label: `“${q}”` }]
    : parts.map((_, i) => {
        const r = parts.slice(0, i + 1).join("/");
        return { label: segLabel(r, names, lang), href: i < parts.length - 1 ? href(id, r) : undefined };
      });

  const search = (
    <form action={`/b/${id}/files`} className="relative" role="search">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-tertiary" />
      <Input name="q" defaultValue={q} aria-label={t(lang, "files.search")} placeholder={t(lang, "files.search")} className="h-7 pl-8 text-[13px]" />
    </form>
  );

  return (
    // A file gets the whole page (documents, PDFs, sheets); folders and search stay at table width.
    <PageBody width={q || stat.isDir ? "wide" : "full"}>
      <LiveRefresh businessId={id} types={LIVE} />
      <SetBreadcrumb items={crumbs} />
      <div data-focus-grid className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside data-focus-hide className="hidden lg:block">
          <div className="sticky top-[calc(var(--topbar-h)+16px)] space-y-3">
            {search}
            <nav aria-label={t(lang, "files.tree")} className="space-y-px">
              <TreeRow href={href(id, "")} label={t(lang, "files.all")} active={!rel && !q} depth={0} icon={<FolderOpenIcon />} />
              {ROOTS.map((r) => (
                <Tree key={r.key} businessId={id} rel={r.key} label={rootLabel(r.key, lang)} open={folder} names={names} depth={0} q={q} />
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-6 lg:hidden">{search}</div>
          {q ? (
            <SearchResults businessId={id} q={q} names={names} lang={lang} />
          ) : stat.isDir ? (
            <FolderView businessId={id} rel={rel} names={names} lang={lang} page={pageNo} />
          ) : (
            <FileView businessId={id} rel={rel} size={stat.size} mtime={stat.mtime} lang={lang} />
          )}
        </div>
      </div>
    </PageBody>
  );
}

function TreeRow({
  href: to,
  label,
  active,
  depth,
  icon,
  chevron,
  title,
}: {
  href: string;
  label: string;
  active: boolean;
  depth: number;
  icon: ReactNode;
  chevron?: "open" | "closed";
  title?: string;
}) {
  return (
    <Link
      href={to}
      title={title}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md pr-2 text-[13px] leading-[18px] font-medium transition-colors duration-100 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
        active ? "bg-accent text-foreground" : "text-sidebar-foreground hover:bg-hover",
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      <span aria-hidden className="flex size-4 items-center justify-center text-tertiary [&_svg]:size-3.5!">
        {chevron === "open" ? <ChevronDownIcon /> : chevron === "closed" ? <ChevronRightIcon /> : null}
      </span>
      <span className={cn(active ? "text-foreground" : "text-tertiary")}>{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Folders only; the folder you're in (and its parents) are expanded. */
function Tree({ businessId, rel, label, open, names, depth, q }: { businessId: string; rel: string; label: string; open: string; names: Names; depth: number; q: string }) {
  const expanded = open === rel || open.startsWith(`${rel}/`);
  const here = open === rel && !q;
  const subfolders = expanded ? listFolders(rel) : [];
  return (
    <div className="space-y-px">
      <TreeRow
        href={href(businessId, rel)}
        label={label}
        active={here}
        depth={depth}
        title={rel}
        chevron={expanded ? "open" : "closed"}
        icon={expanded ? <FolderOpenIcon /> : <FolderIcon />}
      />
      {subfolders.map((f) => (
        <Tree key={f.rel} businessId={businessId} rel={f.rel} label={names.get(f.rel)?.split(" · ")[0] ?? f.name} open={open} names={names} depth={depth + 1} q={q} />
      ))}
    </div>
  );
}

function NameCell({ e, names, showPath }: { e: Entry; names: Names; showPath?: boolean }) {
  const Icon = ICONS[e.type];
  const label = e.isDir ? (names.get(e.rel) ?? e.name) : (e.title ?? e.name);
  const sub = showPath ? e.rel : e.title && e.title !== e.name ? e.name : null;
  return (
    <span className="flex min-w-0 items-center gap-2 py-1.5">
      <Icon className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} />
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate font-mono text-xs font-normal text-tertiary">{sub}</span>}
      </span>
    </span>
  );
}

function entryColumns(names: Names, lang: UiLang, showPath = false): Column<Entry>[] {
  return [
    { key: "name", header: t(lang, "files.col.name"), icon: <TypeIcon />, title: (e) => e.rel, cell: (e) => <NameCell e={e} names={names} showPath={showPath} /> },
    {
      key: "size",
      header: t(lang, "files.col.size"),
      icon: <HashIcon />,
      width: 110,
      align: "right",
      cell: (e) => (e.isDir ? tn(lang, "files.items", e.children ?? 0) : size(e.size)),
    },
    { key: "modified", header: t(lang, "files.col.modified"), icon: <CalendarIcon />, width: 190, cell: (e) => <span className="text-muted-foreground">{when(e.mtime, lang)}</span> },
  ];
}

function FolderView({ businessId, rel, names, lang, page }: { businessId: string; rel: string; names: Names; lang: UiLang; page: number }) {
  if (!rel) {
    const entries = listDir(rel) ?? [];
    const rows = ROOTS.map((r) => ({ key: r.key, children: entries.find((x) => x.rel === r.key)?.children ?? 0 }));
    return (
      <>
        <PageHeader title={t(lang, "files.title")} description={t(lang, "files.subtitle")} />
        <DataTable
          label={t(lang, "files.title")}
          rows={rows}
          getRowId={(r) => r.key}
          rowHref={(r) => href(businessId, r.key)}
          minWidth={520}
          columns={[
            {
              key: "name",
              header: t(lang, "files.col.name"),
              icon: <TypeIcon />,
              width: 220,
              cell: (r) => (
                <span className="flex items-center gap-2">
                  <FolderIcon className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} />
                  <span className="truncate">{rootLabel(r.key, lang)}</span>
                </span>
              ),
            },
            { key: "items", header: t(lang, "files.col.items"), icon: <LayersIcon />, width: 110, cell: (r) => tn(lang, "files.items", r.children) },
            { key: "about", header: t(lang, "files.col.about"), icon: <InfoIcon />, title: (r) => rootHint(r.key, lang), cell: (r) => <span className="text-muted-foreground">{rootHint(r.key, lang)}</span> },
          ]}
        />
      </>
    );
  }
  const all = listDir(rel, { details: false }) ?? [];
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const entries = withDetails(all.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE));
  const visual = entries.filter((e) => e.type === "image" || e.type === "video");
  const rest = entries.filter((e) => e.type !== "image" && e.type !== "video");
  return (
    <>
      <PageHeader title={segLabel(rel, names, lang)} description={tn(lang, "files.items", all.length)} />
      {!entries.length && <EmptyState icon={<FolderOpenIcon />} title={t(lang, "files.emptyFolder")} body={t(lang, "files.emptyFolderBody")} />}
      {visual.length > 0 && (
        <Gallery className="mb-10">
          {visual.map((e, i) => (
            <GalleryTile
              key={e.rel}
              href={href(businessId, e.rel)}
              caption={<span title={e.name}>{e.name}</span>}
              meta={`${size(e.size)} · ${e.mtime.toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" })}`}
              badge={
                e.type === "video" ? (
                  <span className="flex size-6 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm">
                    <VideoIcon className="size-3.5" />
                  </span>
                ) : undefined
              }
              thumb={
                e.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
                  <img src={fileUrl(businessId, e.rel)} alt={e.name} loading={i < 24 ? "eager" : "lazy"} />
                ) : (
                  <video src={`${fileUrl(businessId, e.rel)}#t=0.5`} preload="metadata" muted playsInline />
                )
              }
            />
          ))}
        </Gallery>
      )}
      {rest.length > 0 && (
        <DataTable label={segLabel(rel, names, lang)} rows={rest} getRowId={(e) => e.rel} rowHref={(e) => href(businessId, e.rel)} columns={entryColumns(names, lang)} minWidth={560} />
      )}
      {pages > 1 && (
        <nav aria-label={t(lang, "files.pages")} className="mt-6 flex items-center justify-between text-[13px] text-muted-foreground">
          {page > 1 ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={href(businessId, rel, page - 1)}>
                <ChevronLeftIcon /> {t(lang, "files.newerPage")}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="tabular-nums">{t(lang, "files.pageOf", { page: Math.min(page, pages), pages })}</span>
          {page < pages ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={href(businessId, rel, page + 1)}>
                {t(lang, "files.olderPage")} <ChevronRightIcon />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

function SearchResults({ businessId, q, names, lang }: { businessId: string; q: string; names: Names; lang: UiLang }) {
  const found = searchFiles(q);
  return (
    <>
      <PageHeader
        title={tn(lang, "files.found", found.length, { q })}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href={href(businessId, "")}>{t(lang, "files.clearSearch")}</Link>
          </Button>
        }
      />
      <DataTable
        label={t(lang, "files.search")}
        rows={found}
        getRowId={(e) => e.rel}
        rowHref={(e) => href(businessId, e.rel)}
        columns={entryColumns(names, lang, true)}
        minWidth={560}
        empty={<EmptyState icon={<SearchXIcon />} title={t(lang, "files.noMatches", { q })} />}
      />
    </>
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

function FileView({ businessId, rel, size: bytes, mtime, lang }: { businessId: string; rel: string; size: number; mtime: Date; lang: UiLang }) {
  const type = fileType(rel);
  const name = rel.split("/").pop() ?? rel;
  const url = fileUrl(businessId, rel);
  const siblings = (listDir(rel.split("/").slice(0, -1).join("/"), { details: false }) ?? []).filter((e) => !e.isDir);
  const i = siblings.findIndex((e) => e.rel === rel);
  const newer = i > 0 ? siblings[i - 1] : undefined;
  const older = i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : undefined;
  const text = ["markdown", "csv", "json", "text"].includes(type) ? readText(rel) : null;
  const Icon = ICONS[type];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon className="size-5 shrink-0 text-tertiary" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base leading-6 font-semibold text-foreground" title={name}>
            {name}
          </h1>
          <p className="text-xs text-tertiary tabular-nums">
            {size(bytes)} · {when(mtime, lang)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {newer ? (
            <IconButton label={`${t(lang, "files.newerFile")}: ${newer.name}`} asChild>
              <Link href={href(businessId, newer.rel)}>
                <ChevronLeftIcon />
              </Link>
            </IconButton>
          ) : (
            <IconButton label={t(lang, "files.newerFile")} disabled>
              <ChevronLeftIcon />
            </IconButton>
          )}
          {older ? (
            <IconButton label={`${t(lang, "files.olderFile")}: ${older.name}`} asChild>
              <Link href={href(businessId, older.rel)}>
                <ChevronRightIcon />
              </Link>
            </IconButton>
          ) : (
            <IconButton label={t(lang, "files.olderFile")} disabled>
              <ChevronRightIcon />
            </IconButton>
          )}
          <Button asChild variant="secondary" size="sm" className="ml-1">
            <a href={fileUrl(businessId, rel, true)}>
              <DownloadIcon /> {t(lang, "files.download")}
            </a>
          </Button>
        </div>
      </div>

      {/* Markdown reads as a document, without a frame. */}
      <div className={cn("overflow-hidden rounded-lg border border-border", type === "markdown" && "-mx-6 rounded-none border-0 sm:-mx-10")}>
        {type === "image" && (
          <div className="flex justify-center bg-muted p-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- local files from the business folder */}
            <img src={url} alt={name} className="max-h-[75vh] max-w-full rounded-md object-contain" />
          </div>
        )}
        {type === "video" && <video src={url} controls playsInline className="max-h-[75vh] w-full bg-stage" />}
        {type === "audio" && (
          <div className="flex flex-col items-center gap-4 bg-muted p-10">
            <MusicIcon className="size-8 text-placeholder" strokeWidth={1.5} />
            <audio src={url} controls />
          </div>
        )}
        {type === "pdf" && <iframe src={url} title={name} className="h-[75vh] w-full bg-background" />}
        {type === "markdown" && text && (
          <>
            <TopBarActions>
              <DocLayoutButtons />
            </TopBarActions>
            <MarkdownPreview businessId={businessId} rel={rel} text={text.text} />
          </>
        )}
        {type === "csv" && text && <CsvPreview text={text.text} lang={lang} />}
        {type === "json" && text && <pre className="max-h-[75vh] overflow-auto p-4 font-mono text-xs leading-5">{prettyJson(text.text)}</pre>}
        {type === "text" && text && <pre className="max-h-[75vh] overflow-auto p-4 font-mono text-xs leading-5 whitespace-pre-wrap">{text.text}</pre>}
        {type === "other" && (
          <EmptyState
            compact
            icon={<FileIcon />}
            title={t(lang, "files.noPreview")}
            body={t(lang, "files.noPreviewBody")}
            action={
              <Button asChild variant="secondary" size="sm">
                <a href={fileUrl(businessId, rel, true)}>
                  <DownloadIcon /> {t(lang, "files.download")}
                </a>
              </Button>
            }
          />
        )}
        {text?.truncated && <p className="border-t border-border p-2 text-center text-xs text-tertiary">{t(lang, "files.truncated")}</p>}
      </div>
    </div>
  );
}

function MarkdownPreview({ businessId, rel, text }: { businessId: string; rel: string; text: string }) {
  const { meta, body } = frontMatter(text);
  return (
    // The page scrolls (no box inside it); the text keeps a reading width unless full width is on.
    <div className="mx-auto w-full max-w-[var(--doc-w)] px-6 py-8 sm:px-10">
      {meta.length > 0 && (
        <PropertyList
          className="mb-5 border-b border-border pb-4"
          items={meta.map(([k, v]) => ({ label: k, value: <span className="truncate">{v}</span> }))}
        />
      )}
      <div className="text-[15px] leading-[26px]">
        <FileMarkdown businessId={businessId} path={rel}>
          {body}
        </FileMarkdown>
      </div>
    </div>
  );
}

function CsvPreview({ text, lang }: { text: string; lang: UiLang }) {
  const rows = parseCsv(text);
  const [head, ...body] = rows;
  if (!head) return <EmptyState compact icon={<TableIcon />} title={t(lang, "files.emptyFile")} />;
  const columns: Column<{ i: number; r: string[] }>[] = head.map((h, j) => ({
    key: String(j),
    header: h || " ",
    title: (row) => row.r[j],
    cell: (row) => row.r[j] ?? "",
  }));
  return (
    <div className="max-h-[75vh] overflow-auto px-4">
      <DataTable label={t(lang, "files.title")} rows={body.map((r, i) => ({ i, r }))} getRowId={(row) => String(row.i)} columns={columns} minWidth={Math.max(480, head.length * 140)} />
      {rows.length >= 300 && <p className="p-2 text-center text-xs text-tertiary">{t(lang, "files.first300")}</p>}
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
