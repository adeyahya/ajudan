/**
 * @mentions in a doc's markdown (Docs, src/app/b/[id]/docs). Typing "@" in the editor
 * inserts a markdown link with an `ajudan://` URL:
 *
 *   [Ana Putri](ajudan://contact/<id>)   [Logo](ajudan://asset/media%2Flogo.png)
 *   [Price list](ajudan://deliverable/<id>)   [About us](ajudan://doc/<context page id>)
 *
 * Saving the doc turns each mention into a `links` row (deliverable → mentioned object,
 * src/lib/docs.ts). The preview and exports turn the URLs into app links or plain names.
 * Pure: safe in client components and tests.
 */

export type MentionType = "contact" | "asset" | "deliverable" | "doc";
export type MentionRef = { type: MentionType; id: string };
export type Mention = MentionRef & { label: string };

export const MENTION_TYPES: MentionType[] = ["contact", "asset", "deliverable", "doc"];

const MENTION_RE = /\[([^\]\n]*)\]\(ajudan:\/\/(contact|asset|deliverable|doc)\/([^)\s]+)\)/g;

export const mentionKey = (r: MentionRef) => `${r.type}:${r.id}`;

export function mentionUrl(r: MentionRef) {
  return `ajudan://${r.type}/${encodeURIComponent(r.id)}`;
}

/** The markdown a mention is written as; brackets in the name would end the link text early. */
export function mentionMarkdown(label: string, r: MentionRef) {
  const name = label.replace(/[[\]\n]/g, " ").replace(/\s+/g, " ").trim() || r.id;
  return `[${name}](${mentionUrl(r)})`;
}

function decode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Every mention in the text, once each (first label wins), in order of appearance. */
export function parseMentions(markdown: string): Mention[] {
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const m of markdown.matchAll(MENTION_RE)) {
    const ref = { type: m[2] as MentionType, id: decode(m[3]) };
    if (!ref.id || seen.has(mentionKey(ref))) continue;
    seen.add(mentionKey(ref));
    out.push({ ...ref, label: m[1] });
  }
  return out;
}

/**
 * What a save changes: mentions to link (new in `after`) and mentions to unlink (in
 * `before` but dropped from `after`). Links the owner made by hand never appear in
 * `before`, so reconciling never removes them.
 */
export function diffMentions(before: MentionRef[], after: MentionRef[]) {
  const was = new Set(before.map(mentionKey));
  const now = new Set(after.map(mentionKey));
  return {
    add: after.filter((r) => !was.has(mentionKey(r))),
    remove: before.filter((r) => !now.has(mentionKey(r))),
  };
}

/** Where a mention opens in the app (the same places as describeRef in src/lib/links.ts). */
export function mentionHref(businessId: string, r: MentionRef) {
  const base = `/b/${businessId}`;
  switch (r.type) {
    case "contact":
      return `${base}/contacts?c=${encodeURIComponent(r.id)}`;
    case "asset":
      return `${base}/library?f=${encodeURIComponent(r.id)}`;
    case "deliverable":
      return `${base}/docs?doc=${encodeURIComponent(r.id)}`;
    case "doc":
      return `${base}/context?page=${encodeURIComponent(r.id)}`;
  }
}

/**
 * The markdown with each mention's URL swapped for its app link, for the preview (the
 * markdown renderer drops unknown URL schemes). Returns the hrefs it wrote, so the
 * renderer can draw those links as chips.
 */
export function resolveMentions(markdown: string, businessId: string) {
  const hrefs = new Set<string>();
  const text = markdown.replace(MENTION_RE, (_m, label: string, type: MentionType, id: string) => {
    const href = mentionHref(businessId, { type, id: decode(id) });
    hrefs.add(href);
    return `[${label}](${href})`;
  });
  return { text, hrefs };
}

/** The markdown with mentions as plain names: for exports, where app links lead nowhere. */
export function stripMentions(markdown: string) {
  return markdown.replace(MENTION_RE, (_m, label: string) => label);
}

/**
 * The word being typed after "@" just before the caret ("@an" → "an"), or null when the
 * caret isn't in a mention. "@" must start the text or follow a space or "(", so emails
 * (ana@shop.id) don't open the picker.
 */
export function mentionQuery(textBeforeCaret: string): string | null {
  const m = /(?:^|[\s(])@([^\s@[\]()]{0,40})$/.exec(textBeforeCaret);
  return m ? m[1] : null;
}
