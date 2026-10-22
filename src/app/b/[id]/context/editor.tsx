"use client";

import "@blocknote/shadcn/style.css";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { en as bnEn } from "@blocknote/core/locales";
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { FileTextIcon, ImagesIcon, LightbulbIcon, UserIcon } from "lucide-react";
import { useLang, useT, useTn } from "@/components/i18n";
import type { UiLang } from "@/lib/i18n";

/**
 * The page editor (BlockNote, MPL-2.0): slash menu, headings, lists, tables, quotes,
 * plus a callout block, an asset gallery block and @mentions of pages and people.
 * Teammates read the markdown it exports; the blocks themselves are saved too so the
 * owner's callouts, mentions and galleries come back as they were. Markdown written
 * elsewhere (an accepted suggestion) is parsed back, and restoreSpecials turns its
 * mention links, 💡 quotes and gallery lines into the rich blocks again.
 */

export type EditorAsset = { path: string; title: string; tags: string[]; kind: string; usedIn: number };
export type EditorData = {
  businessId: string;
  pages: { id: string; title: string }[];
  contacts: { id: string; name: string }[];
  assets: EditorAsset[];
  openPage: (id: string) => void;
  openContact: (id: string) => void;
};

const Data = createContext<EditorData | null>(null);

const Mention = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: { kind: { default: "page" }, ref: { default: "" }, label: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => <MentionChip kind={inlineContent.props.kind} id={inlineContent.props.ref} label={inlineContent.props.label} />,
    toExternalHTML: ({ inlineContent }) => <a href={`ajudan://${inlineContent.props.kind}/${inlineContent.props.ref}`}>@{inlineContent.props.label}</a>,
  },
);

function MentionChip({ kind, id, label }: { kind: string; id: string; label: string }) {
  const data = useContext(Data);
  return (
    <button
      type="button"
      contentEditable={false}
      onClick={() => (kind === "contact" ? data?.openContact(id) : data?.openPage(id))}
      className="inline rounded-sm bg-amber-200/70 px-1 font-medium text-[#6e452c] hover:bg-amber-300/80"
    >
      @{label}
    </button>
  );
}

const Callout = createReactBlockSpec(
  { type: "callout", propSchema: { emoji: { default: "💡" } }, content: "inline" },
  {
    render: ({ block, contentRef }) => (
      <div className="flex w-full gap-2 rounded-sm border-l-4 border-amber-500 bg-amber-100/80 px-3 py-2">
        <span contentEditable={false} aria-hidden>
          {block.props.emoji}
        </span>
        <div ref={contentRef} className="min-w-0 flex-1" />
      </div>
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <blockquote>
        <p>
          {block.props.emoji} <span ref={contentRef} />
        </p>
      </blockquote>
    ),
  },
);

const Gallery = createReactBlockSpec(
  { type: "gallery", propSchema: { tag: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => <GalleryView tag={block.props.tag} editable={editor.isEditable} onTag={(tag) => editor.updateBlock(block, { props: { tag } })} />,
    toExternalHTML: ({ block }) => <p>{`[Asset gallery: files tagged #${block.props.tag || "?"}; list_media(tag="${block.props.tag}")]`}</p>,
  },
);

function GalleryView({ tag, editable, onTag }: { tag: string; editable: boolean; onTag: (tag: string) => void }) {
  const data = useContext(Data);
  const t = useT();
  const tn = useTn();
  const tags = useMemo(() => [...new Set((data?.assets ?? []).flatMap((a) => a.tags))].sort(), [data]);
  const shown = (data?.assets ?? []).filter((a) => tag && a.tags.includes(tag));
  return (
    <div contentEditable={false} className="w-full rounded-sm border border-[#e6d6bd] bg-white/60 p-2">
      <div className="mb-2 flex items-center gap-2 text-xs text-[#6e452c]">
        <ImagesIcon className="size-4" />
        <span>{t("context.gallery.pickTag")}</span>
        <select value={tag} disabled={!editable} onChange={(e) => onTag(e.target.value)} className="rounded-sm border border-[#e6d6bd] bg-white px-1 py-0.5 text-xs">
          <option value="">{t("context.gallery.noTag")}</option>
          {tags.map((x) => (
            <option key={x} value={x}>
              #{x}
            </option>
          ))}
        </select>
      </div>
      {tag && !shown.length ? (
        <p className="text-xs text-[#8a6f5a]">{t("context.gallery.empty", { tag })}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {shown.map((a) => (
            <figure key={a.path} className="space-y-1">
              {a.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- files from the business folder
                <img src={`/api/b/${data?.businessId}/files/${a.path}`} alt={a.title || a.path} className="aspect-square w-full rounded-sm object-cover" />
              ) : a.kind === "video" ? (
                <video src={`/api/b/${data?.businessId}/files/${a.path}`} className="aspect-square w-full rounded-sm bg-black object-cover" muted />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-sm bg-[#efe3cf] text-xs">{a.kind}</div>
              )}
              <figcaption className="truncate text-[11px] text-[#6e452c]" title={a.title || a.path}>
                {a.title || a.path.replace(/^media\//, "")}
                {a.usedIn > 0 && <span className="block text-[#8a6f5a]">{tn("context.gallery.usedIn", a.usedIn)}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, callout: Callout(), gallery: Gallery() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, mention: Mention },
});
type Editor = typeof schema.BlockNoteEditor;
type Blocks = typeof schema.PartialBlock;

/** Blocks the owner doesn't need here (uploads aren't wired to the library). */
const HIDDEN = new Set(["image", "video", "audio", "file", "toggle_heading", "toggle_list"]);

/** BlockNote has no Indonesian: the slash menu and placeholders the owner sees most. */
const ID_SLASH: Record<string, [string, string]> = {
  heading: ["Judul 1", "Judul"],
  heading_2: ["Judul 2", "Judul"],
  heading_3: ["Judul 3", "Judul"],
  quote: ["Kutipan", "Blok dasar"],
  numbered_list: ["Daftar bernomor", "Blok dasar"],
  bullet_list: ["Daftar poin", "Blok dasar"],
  check_list: ["Daftar centang", "Blok dasar"],
  paragraph: ["Paragraf", "Blok dasar"],
  code_block: ["Blok kode", "Blok dasar"],
  table: ["Tabel", "Lanjutan"],
  divider: ["Pemisah", "Blok dasar"],
};

function dictionary(lang: UiLang, placeholder: string) {
  if (lang !== "id") return { ...bnEn, placeholders: { ...bnEn.placeholders, default: placeholder, emptyDocument: placeholder } };
  const slash = Object.fromEntries(
    Object.entries(bnEn.slash_menu).map(([k, v]) => [k, ID_SLASH[k] ? { ...v, title: ID_SLASH[k][0], group: ID_SLASH[k][1] } : v]),
  ) as typeof bnEn.slash_menu;
  return {
    ...bnEn,
    slash_menu: slash,
    placeholders: { ...bnEn.placeholders, default: placeholder, emptyDocument: placeholder, heading: "Judul", bulletListItem: "Daftar", numberedListItem: "Daftar", checkListItem: "Daftar" },
  };
}

type Loose = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: Loose[]; text?: string; href?: string };

/** Mention links, 💡 quotes and gallery lines in parsed markdown back into rich blocks. */
export function restoreSpecials(blocks: Loose[]): Loose[] {
  return blocks.map((b) => {
    let block: Loose = { ...b, children: b.children ? restoreSpecials(b.children) : b.children };
    if (Array.isArray(block.content)) {
      block.content = (block.content as Loose[]).map((c) => {
        const m = c.type === "link" && typeof c.href === "string" ? /^(?:ajudan:\/\/|https:\/\/ajudan\.invalid\/)(page|contact)\/(.+)$/.exec(c.href) : null;
        if (!m) return c;
        const label = ((c.content as Loose[] | undefined) ?? []).map((x) => x.text ?? "").join("").replace(/^@/, "");
        return { type: "mention", props: { kind: m[1], ref: m[2], label } };
      });
      const first = (block.content as Loose[])[0];
      if (block.type === "quote" && first?.type === "text" && first.text?.startsWith("💡")) {
        block = { ...block, type: "callout", props: { emoji: "💡" }, content: [{ ...first, text: first.text.replace(/^💡\s*/, "") }, ...(block.content as Loose[]).slice(1)] };
      }
      const text = (block.content as Loose[]).map((x) => x.text ?? "").join("");
      const g = block.type === "paragraph" ? /^\[Asset gallery: files tagged #([^;\]]*)/.exec(text) : null;
      if (g) block = { type: "gallery", props: { tag: g[1] === "?" ? "" : g[1] } };
    }
    return block;
  });
}

function groupTogether(items: DefaultReactSuggestionItem[]) {
  const order = [...new Set(items.map((i) => i.group ?? ""))];
  return [...items].sort((a, b) => order.indexOf(a.group ?? "") - order.indexOf(b.group ?? ""));
}

export default function PageEditor({
  data,
  blocks,
  markdown,
  externalStamp,
  editable = true,
  onSave,
}: {
  data: EditorData;
  /** The editor's saved blocks, when the page was last written here. */
  blocks: unknown[] | null;
  markdown: string;
  /** Changes when the page was rewritten elsewhere (blocks dropped): reload from markdown. */
  externalStamp: string | null;
  editable?: boolean;
  onSave: (v: { body: string; blocks: unknown[] }) => void;
}) {
  const lang = useLang();
  const t = useT();
  const loading = useRef(true);
  const editor = useCreateBlockNote(
    {
      schema,
      initialContent: blocks?.length ? (blocks as Blocks[]) : undefined,
      dictionary: dictionary(lang, t("context.editor.placeholder")),
    },
    [],
  ) as Editor;

  // Pages without saved blocks (seeded, or changed by an accepted suggestion) start from markdown.
  const applied = useRef<string | null>(blocks?.length ? "blocks" : null);
  useEffect(() => {
    const key = externalStamp ?? "blocks";
    if (applied.current === key) {
      loading.current = false;
      return;
    }
    if (!externalStamp && blocks?.length) {
      applied.current = key;
      loading.current = false;
      return;
    }
    loading.current = true;
    // Outside React's render (the editor's node views flush synchronously).
    const timer = setTimeout(() => {
      // The parser drops links with our own scheme: give mentions a URL it keeps.
      const md = markdown.replace(/\]\(ajudan:\/\/(page|contact)\//g, "](https://ajudan.invalid/$1/");
      const parsed = restoreSpecials(editor.tryParseMarkdownToBlocks(md) as Loose[]) as Blocks[];
      editor.replaceBlocks(editor.document, parsed.length ? parsed : [{ type: "paragraph" }]);
      // Only now (a cleared timer, e.g. Strict Mode's second run, must try again).
      applied.current = key;
      // Let the replace's change event pass before edits count as the owner's.
      setTimeout(() => (loading.current = false), 0);
    }, 0);
    return () => clearTimeout(timer);
  }, [editor, externalStamp, markdown, blocks]);

  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  });

  // Groups must stay together in the menu: ours go in after the defaults of the same group.
  const slashItems = (): DefaultReactSuggestionItem[] => groupTogether([
    ...getDefaultReactSlashMenuItems(editor).filter((i) => !HIDDEN.has((i as { key?: string }).key ?? "")),
    {
      title: t("context.callout"),
      subtext: t("context.calloutHint"),
      group: lang === "id" ? "Blok dasar" : "Basic blocks",
      icon: <LightbulbIcon size={18} />,
      aliases: ["callout", "note", "catatan", "info"],
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout" }),
    },
    {
      title: t("context.gallery"),
      subtext: t("context.galleryHint"),
      group: lang === "id" ? "Lanjutan" : "Advanced",
      icon: <ImagesIcon size={18} />,
      aliases: ["gallery", "galeri", "assets", "aset", "foto"],
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "gallery" }),
    },
  ]);

  const mentionItems = (): DefaultReactSuggestionItem[] => [
    ...data.pages.map((p) => ({
      title: p.title,
      group: t("context.mention.pages"),
      icon: <FileTextIcon size={16} />,
      onItemClick: () => editor.insertInlineContent([{ type: "mention", props: { kind: "page", ref: p.id, label: p.title } }, " "]),
    })),
    ...data.contacts.map((c) => ({
      title: c.name,
      group: t("context.mention.people"),
      icon: <UserIcon size={16} />,
      onItemClick: () => editor.insertInlineContent([{ type: "mention", props: { kind: "contact", ref: c.id, label: c.name } }, " "]),
    })),
  ];

  return (
    <Data.Provider value={data}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme="light"
        slashMenu={false}
        className="ajudan-page-editor"
        onChange={() => {
          if (loading.current) return;
          save.current({ body: editor.blocksToMarkdownLossy(editor.document), blocks: editor.document as unknown[] });
        }}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={async (q) => filterSuggestionItems(slashItems(), q)} />
        <SuggestionMenuController triggerCharacter="@" getItems={async (q) => filterSuggestionItems(mentionItems(), q).slice(0, 12)} />
      </BlockNoteView>
    </Data.Provider>
  );
}
