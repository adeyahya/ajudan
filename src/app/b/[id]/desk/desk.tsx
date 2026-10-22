"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowUp, ChevronLeft, Headset, MessageCircle, Moon, Paperclip, Users } from "lucide-react";
import { useLang, useT } from "@/components/i18n";
import { Badge, Button, cn, EmptyState, IconButton, Kbd, Skeleton } from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DeskChatSummary, DeskMessage, deskScore } from "@/lib/desk";
import { dateLocale } from "@/lib/i18n";
import type { RestState } from "@/lib/rest";
import { sendDeskReply } from "./actions";

type Score = ReturnType<typeof deskScore>;
type DeskData = { chats: DeskChatSummary[]; score: Score; rest: RestState | null };

/** Ready-made replies in the business's language (they go to customers, so not UI strings). */
const QUICK: Record<string, string[]> = {
  id: ["Halo kak, ada yang bisa dibantu? 😊", "Sebentar ya kak, saya cek dulu 🙏", "Siap kak, terima kasih banyak!", "Mohon maaf atas ketidaknyamanannya kak 🙏"],
  ms: ["Hai, boleh saya bantu? 😊", "Sekejap ya, saya semak dulu 🙏", "Baik, terima kasih banyak!"],
  en: ["Hi! How can I help? 😊", "One moment, let me check 🙏", "Got it, thank you so much!", "Sorry about that, let me sort it out 🙏"],
};

const isGroup = (jid: string) => jid.endsWith("@g.us");
const dayKey = (at: string) => new Date(at).toDateString();

/** The owner's customer-service shift: chat list, conversation, and a small score. */
export function Desk({ businessId, language, initial }: { businessId: string; language: string; initial: DeskData }) {
  const t = useT();
  const lang = useLang();
  const locale = dateLocale(lang);
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial.chats.find((c) => c.needsReply)?.jid ?? initial.chats[0]?.jid ?? null);
  // On a phone the desk shows either the list or one conversation.
  const [phoneConversation, setPhoneConversation] = useState(false);
  const [messages, setMessages] = useState<DeskMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = data.chats.find((c) => c.jid === selected);

  const ago = (at: string) => {
    const m = Math.max(0, Math.round((now - new Date(at).getTime()) / 60_000));
    if (m < 1) return t("desk.ago.now");
    if (m < 60) return t("desk.ago.m", { n: m });
    const h = Math.round(m / 60);
    return h < 48 ? t("desk.ago.h", { n: h }) : t("desk.ago.d", { n: Math.round(h / 24) });
  };
  const clock = (at: string) => new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const dayLabel = (at: string) => {
    const d = new Date(at);
    const today = new Date(now);
    if (d.toDateString() === today.toDateString()) return t("desk.today");
    today.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return t("desk.yesterday");
    return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  };

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch(`/api/b/${businessId}/desk`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as DeskData);
    } catch {
      // try again on the next poll
    }
    setNow(Date.now());
  }, [businessId]);

  const loadMessages = useCallback(
    async (jid: string) => {
      try {
        const res = await fetch(`/api/b/${businessId}/desk?chat=${encodeURIComponent(jid)}`, { cache: "no-store" });
        if (!res.ok) return;
        const { messages: next } = (await res.json()) as { messages: DeskMessage[] };
        setMessages((prev) => (prev && prev.length === next.length && prev.at(-1)?.id === next.at(-1)?.id ? prev : next));
      } catch {
        // try again on the next poll
      }
    },
    [businessId],
  );

  useEffect(() => {
    const t = setInterval(loadChats, 8000);
    return () => clearInterval(t);
  }, [loadChats]);

  useEffect(() => {
    if (!selected) return;
    const first = setTimeout(() => loadMessages(selected), 0);
    const t = setInterval(() => loadMessages(selected), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [selected, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const pick = (jid: string) => {
    setPhoneConversation(true);
    if (jid === selected) return;
    setSelected(jid);
    setMessages(null);
    setDraft("");
    setError(null);
  };

  const send = (text = draft) => {
    const jid = selected;
    if (!jid || !text.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const r = await sendDeskReply(businessId, jid, text, lang);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setDraft("");
      setMessages((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, fromMe: true, sender: t("desk.you"), text: text.trim(), at: new Date().toISOString() }]);
      toast(t("desk.answeredToast"), { icon: <Headset className="size-4" /> });
      void loadChats();
    });
  };

  const waiting = data.chats.filter((c) => c.needsReply).length;
  const { score } = data;
  const quick = QUICK[language] ?? QUICK.en;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Shift status */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4 text-xs">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-sm text-[13px] leading-[18px] font-medium text-foreground">
              <Headset className="size-4 text-tertiary" strokeWidth={1.75} />
              {t("desk.onShift")}
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72 flex-col items-start gap-0.5 text-left">
            <span className="font-medium">{t("desk.level", { level: score.level, xp: score.toNext })}</span>
            <span className="opacity-80">{t("desk.about")}</span>
          </TooltipContent>
        </Tooltip>
        <span className="truncate text-tertiary tabular-nums">
          {t("desk.answeredToday", { n: score.today })} · <span className={cn(waiting > 0 && "font-medium text-destructive")}>{t("desk.waiting", { n: waiting })}</span>
        </span>
        {data.rest && (
          <Badge tone="purple" className="ml-auto">
            <Moon /> {t("desk.resting", { time: new Date(data.rest.until).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })}
          </Badge>
        )}
      </div>

      {data.chats.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <EmptyState icon={<MessageCircle />} title={t("desk.emptyTitle")} body={t("desk.emptyBody")} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[300px_minmax(0,1fr)]">
          {/* Chats */}
          <nav aria-label={t("desk.chats")} className={cn("min-h-0 overflow-y-auto border-border p-1.5 md:border-r", phoneConversation && "hidden md:block")}>
            <ul className="space-y-px">
              {data.chats.map((c) => (
                <li key={c.jid}>
                  <button
                    type="button"
                    onClick={() => pick(c.jid)}
                    aria-current={c.jid === selected || undefined}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors duration-100 hover:bg-hover",
                      c.jid === selected && "md:bg-accent",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {c.needsReply && <span className="size-2 shrink-0 rounded-full bg-destructive" role="img" aria-label={t("desk.needsReply")} />}
                      <span className={cn("flex-1 truncate text-sm leading-5 text-foreground", c.needsReply ? "font-semibold" : "font-medium")}>{c.name}</span>
                      {c.last && <span className="shrink-0 text-xs text-tertiary tabular-nums">{ago(c.last.at)}</span>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.last ? `${c.last.fromMe ? t("desk.youPrefix") : ""}${c.last.text || (c.last.media ? `[${c.last.media}]` : "")}` : t("desk.noMessagesYet")}
                    </span>
                    {c.teammate && <span className="truncate text-xs text-tertiary">{t("desk.with", { name: c.teammate })}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Conversation */}
          <section aria-label={chat?.name ?? t("desk.conversation")} className={cn("flex min-h-0 flex-col", !phoneConversation && "hidden md:flex")}>
            {chat ? (
              <>
                <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2 md:px-4">
                  <IconButton label={t("desk.back")} className="md:hidden" onClick={() => setPhoneConversation(false)}>
                    <ChevronLeft />
                  </IconButton>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm leading-5 font-semibold text-foreground">{chat.name}</div>
                    <div className="flex items-center gap-1 truncate text-xs text-tertiary">
                      {isGroup(chat.jid) && <Users className="size-3 shrink-0" />}
                      {isGroup(chat.jid) ? t("desk.group") : t("desk.chat")}
                      {chat.teammate && <span className="truncate">· {t("desk.keeps", { name: chat.teammate })}</span>}
                    </div>
                  </div>
                  {chat.needsReply && <Badge tone="red">{t("desk.customerWaiting")}</Badge>}
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
                  {messages === null ? (
                    <div className="space-y-3" aria-busy>
                      <Skeleton className="h-10 w-[55%] rounded-lg" />
                      <Skeleton className="ml-auto h-10 w-[45%] rounded-lg" />
                      <Skeleton className="h-14 w-[60%] rounded-lg" />
                    </div>
                  ) : messages.length === 0 ? (
                    <EmptyState compact icon={<MessageCircle />} title={t("desk.noSynced")} />
                  ) : (
                    <ol className="mx-auto max-w-3xl space-y-1.5">
                      {messages.map((m, i) => {
                        const newDay = i === 0 || dayKey(messages[i - 1].at) !== dayKey(m.at);
                        return (
                          <Fragment key={m.id}>
                            {newDay && (
                              <li aria-hidden className="flex justify-center py-2">
                                <span className="rounded-full bg-background px-2 text-xs text-tertiary">{dayLabel(m.at)}</span>
                              </li>
                            )}
                            <li className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
                              <div
                                className={cn(
                                  "max-w-[80%] rounded-lg px-3 py-2 text-sm leading-[22px] break-words whitespace-pre-wrap text-foreground",
                                  m.fromMe ? "bg-primary-soft" : "bg-muted",
                                )}
                              >
                                {!m.fromMe && isGroup(chat.jid) && <div className="text-xs font-semibold text-muted-foreground">{m.sender}</div>}
                                {m.media && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Paperclip className="size-3" /> {m.media}
                                  </div>
                                )}
                                {m.text}
                                <div className="mt-0.5 text-right text-xs text-tertiary tabular-nums">{clock(m.at)}</div>
                              </div>
                            </li>
                          </Fragment>
                        );
                      })}
                    </ol>
                  )}
                  <div ref={bottomRef} />
                </div>

                <div className="shrink-0 space-y-2 px-3 pt-2 pb-3 md:px-6">
                  <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
                    {quick.map((q) => (
                      <Button
                        key={q}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="shrink-0 rounded-full font-normal"
                        onClick={() => {
                          setDraft((d) => (d.trim() ? `${d} ${q}` : q));
                          inputRef.current?.focus();
                        }}
                      >
                        {q}
                      </Button>
                    ))}
                  </div>
                  <form
                    className="rounded-lg border border-input bg-background transition-[border-color,box-shadow] duration-100 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                  >
                    <textarea
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={2}
                      aria-label={t("desk.replyTo", { name: chat.name })}
                      placeholder={t("desk.replyTo", { name: chat.name })}
                      className="block max-h-48 min-h-[44px] w-full resize-none bg-transparent px-3 pt-2.5 text-sm leading-[22px] text-foreground outline-none placeholder:text-placeholder"
                    />
                    <div className="flex items-center gap-2 px-2 pb-2">
                      <span className="hidden text-xs text-tertiary sm:inline">
                        <Kbd>↵</Kbd> {t("desk.toSend")} · <Kbd>⇧↵</Kbd> {t("desk.newLine")}
                      </span>
                      <IconButton label={t("desk.send")} shortcut="↵" side="top" type="submit" variant="primary" className="ml-auto text-white" loading={pending} disabled={pending || !draft.trim()}>
                        <ArrowUp />
                      </IconButton>
                    </div>
                  </form>
                  {error && (
                    <p role="alert" className="text-xs text-destructive">
                      {error}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState compact icon={<MessageCircle />} title={t("desk.pickChat")} />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
