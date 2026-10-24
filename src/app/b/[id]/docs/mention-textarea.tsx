"use client";

import { BookOpen, FileTextIcon, ImageIcon, UserRound } from "lucide-react";
import { useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { useT } from "@/components/i18n";
import { cn, Textarea } from "@/components/kit";
import { mentionMarkdown, mentionQuery, type MentionRef, type MentionType } from "@/lib/docs-mentions";

export type MentionOption = MentionRef & { label: string; hint?: string };

const ICONS: Record<MentionType, typeof UserRound> = { contact: UserRound, asset: ImageIcon, deliverable: FileTextIcon, doc: BookOpen };
const MAX_SHOWN = 8;

/** Where the caret is inside a textarea, in px from its top-left (a hidden mirror div with the same text and styles). */
function caretPosition(ta: HTMLTextAreaElement, pos: number) {
  const style = getComputedStyle(ta);
  const div = document.createElement("div");
  const props = [
    "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
    "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "textIndent", "tabSize",
  ] as const;
  for (const p of props) div.style[p] = style[p];
  Object.assign(div.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement("span");
  span.textContent = ta.value.slice(pos) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20;
  const at = { top: span.offsetTop - ta.scrollTop + line, left: span.offsetLeft - ta.scrollLeft };
  div.remove();
  return at;
}

/** Best matches first: names starting with the query, then names containing it. */
function rank(options: MentionOption[], q: string) {
  const s = q.toLowerCase();
  if (!s) return options.slice(0, MAX_SHOWN);
  const starts: MentionOption[] = [];
  const has: MentionOption[] = [];
  for (const o of options) {
    const l = o.label.toLowerCase();
    if (l.startsWith(s) || l.split(/\s+/).some((w) => w.startsWith(s))) starts.push(o);
    else if (l.includes(s)) has.push(o);
    if (starts.length >= MAX_SHOWN) break;
  }
  return [...starts, ...has].slice(0, MAX_SHOWN);
}

/**
 * The doc body: a growing textarea where "@" opens a picker of contacts, library files and
 * other docs, and choosing one writes a mention link (src/lib/docs-mentions.ts).
 */
export function MentionTextarea({
  value,
  onChange,
  options,
  onKeyDown,
  className,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange"> & { value: string; onChange: (v: string) => void; options: MentionOption[] }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [active, setActive] = useState(0);
  const shown = useMemo(() => (query === null ? [] : rank(options, query)), [options, query]);

  const look = () => {
    const ta = ref.current;
    if (!ta || ta.selectionStart !== ta.selectionEnd) return setQuery(null);
    const q = mentionQuery(ta.value.slice(0, ta.selectionStart));
    if (q !== query) setActive(0);
    setQuery(q);
    if (q !== null) {
      const at = caretPosition(ta, ta.selectionStart - q.length - 1);
      setPos({ top: at.top + 4, left: Math.max(0, Math.min(at.left, ta.clientWidth - 280)) });
    }
  };

  const choose = (o: MentionOption) => {
    const ta = ref.current;
    if (!ta || query === null) return;
    const end = ta.selectionStart;
    const start = end - query.length - 1;
    const text = `${mentionMarkdown(o.label, o)} `;
    onChange(value.slice(0, start) + text + value.slice(end));
    setQuery(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && shown.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(shown[Math.min(active, shown.length - 1)]);
        return;
      }
    }
    if (query !== null && e.key === "Escape") {
      e.preventDefault();
      setQuery(null);
      return;
    }
    onKeyDown?.(e);
  };

  const listId = "doc-mention-list";
  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(look);
        }}
        onKeyDown={keyDown}
        onKeyUp={(e) => {
          if (e.key.startsWith("Arrow") && query === null) look();
        }}
        onClick={look}
        onBlur={() => setQuery(null)}
        aria-autocomplete="list"
        aria-controls={query !== null ? listId : undefined}
        aria-expanded={query !== null}
        aria-activedescendant={query !== null && shown.length ? `${listId}-${active}` : undefined}
        className={className}
      />
      {query !== null && (
        <div
          id={listId}
          role="listbox"
          aria-label={t("docs.mentions")}
          style={{ top: pos.top, left: pos.left }}
          className="absolute z-30 w-[280px] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-tertiary">{t("docs.noMentionMatch", { q: query })}</p>
          ) : (
            shown.map((o, i) => {
              const Icon = ICONS[o.type];
              return (
                <div
                  key={`${o.type}:${o.id}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px]", i === active && "bg-accent")}
                >
                  <Icon className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{o.label}</span>
                  <span className="shrink-0 text-xs text-tertiary">{t(`docs.mention.${o.type}`)}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
