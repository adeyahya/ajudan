"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Badge, Button, Card, cn, Textarea } from "@/components/kit";
import type { DeskChatSummary, DeskMessage, deskScore } from "@/lib/desk";
import type { RestState } from "@/lib/rest";
import { sendDeskReply } from "./actions";

type Score = ReturnType<typeof deskScore>;
type DeskData = { chats: DeskChatSummary[]; score: Score; rest: RestState | null };

const QUICK: Record<string, string[]> = {
  id: ["Halo kak, ada yang bisa dibantu? 😊", "Sebentar ya kak, saya cek dulu 🙏", "Siap kak, terima kasih banyak!", "Mohon maaf atas ketidaknyamanannya kak 🙏"],
  ms: ["Hai, boleh saya bantu? 😊", "Sekejap ya, saya semak dulu 🙏", "Baik, terima kasih banyak!"],
  en: ["Hi! How can I help? 😊", "One moment, let me check 🙏", "Got it, thank you so much!", "Sorry about that, let me sort it out 🙏"],
};

function ago(at: string, now: number) {
  const m = Math.max(0, Math.round((now - new Date(at).getTime()) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** The owner's customer-service shift: chat list, conversation, and a small score. */
export function Desk({ businessId, language, initial }: { businessId: string; language: string; initial: DeskData }) {
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState<string | null>(initial.chats.find((c) => c.needsReply)?.jid ?? initial.chats[0]?.jid ?? null);
  const [messages, setMessages] = useState<DeskMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [xpPop, setXpPop] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const chat = data.chats.find((c) => c.jid === selected);

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
      const r = await sendDeskReply(businessId, jid, text);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setDraft("");
      setMessages((prev) => [...(prev ?? []), { id: `local-${Date.now()}`, fromMe: true, sender: "You", text: text.trim(), at: new Date().toISOString() }]);
      setXpPop((n) => n + 1);
      void loadChats();
    });
  };

  const waiting = data.chats.filter((c) => c.needsReply).length;
  const { score } = data;
  const quick = QUICK[language] ?? QUICK.en;

  return (
    <div className="space-y-4">
      {/* Shift HUD */}
      <Card className="relative flex flex-wrap items-center gap-x-6 gap-y-3 p-3">
        <div className="font-pixel flex items-center gap-2 text-lg">
          <span aria-hidden>🎧</span> On shift
        </div>
        <div className="min-w-40 flex-1">
          <div className="font-pixel flex justify-between text-xs text-muted-foreground">
            <span>Level {score.level} support hero</span>
            <span>{score.toNext} XP to next</span>
          </div>
          <div className="mt-1 h-3 bg-muted outline-2 outline-frame">
            <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${100 - score.toNext}%` }} />
          </div>
        </div>
        <Stat label="Answered today" value={score.today} />
        <Stat label="Waiting on you" value={waiting} hot={waiting > 0} />
        {data.rest && (
          <Badge tone="violet">💤 Team resting until {new Date(data.rest.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Badge>
        )}
        {xpPop > 0 && (
          <span key={xpPop} className="font-pixel pointer-events-none absolute right-6 top-1 animate-[xp-pop_1.2s_ease-out_forwards] text-lg text-primary">
            +10 XP
          </span>
        )}
      </Card>

      {data.chats.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No customer chats on the desk yet. Chats show up here when a teammate is talking with someone on WhatsApp, or when you allow a chat for the team on the Business page.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="max-h-[70vh] overflow-y-auto p-0">
            <ol className="divide-y divide-border">
              {data.chats.map((c) => (
                <li key={c.jid}>
                  <button
                    type="button"
                    onClick={() => pick(c.jid)}
                    className={cn("flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-muted", c.jid === selected && "bg-muted")}
                  >
                    <span className="flex items-center gap-2">
                      {c.needsReply && <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500" aria-label="Waiting for a reply" />}
                      <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                      {c.last && <span className="text-[11px] text-muted-foreground">{ago(c.last.at, now)}</span>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.last ? `${c.last.fromMe ? "You: " : ""}${c.last.text || (c.last.media ? `[${c.last.media}]` : "")}` : "No messages yet"}
                    </span>
                    {c.teammate && <span className="text-[11px] text-muted-foreground">with {c.teammate}</span>}
                  </button>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="flex max-h-[70vh] min-h-[420px] flex-col p-0">
            {chat ? (
              <>
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{chat.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {chat.teammate ? `${chat.teammate} keeps this conversation · ` : ""}
                      {chat.jid.endsWith("@g.us") ? "Group" : "Chat"}
                    </div>
                  </div>
                  {chat.needsReply && <Badge tone="red">Customer waiting</Badge>}
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto bg-muted/40 px-4 py-3">
                  {messages === null ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No messages synced yet.</p>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm shadow-sm",
                            m.fromMe ? "bg-primary text-primary-foreground" : "bg-card",
                          )}
                        >
                          {!m.fromMe && chat.jid.endsWith("@g.us") && <div className="text-[11px] font-semibold opacity-70">{m.sender}</div>}
                          {m.media && <div className="text-xs opacity-80">📎 {m.media}</div>}
                          {m.text}
                          <div className="mt-0.5 text-right text-[10px] opacity-60">{ago(m.at, now)}</div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>
                <div className="space-y-2 border-t border-border p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {quick.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setDraft((d) => (d.trim() ? `${d} ${q}` : q))}
                        className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                  >
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={2}
                      placeholder={`Reply to ${chat.name}… (Enter to send, Shift+Enter for a new line)`}
                      className="min-h-0 flex-1 resize-none"
                    />
                    <Button type="submit" disabled={pending || !draft.trim()}>
                      {pending ? "Sending…" : "Send"}
                    </Button>
                  </form>
                  {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">Pick a chat.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hot }: { label: string; value: number; hot?: boolean }) {
  return (
    <div className="text-center">
      <div className={cn("font-pixel text-xl leading-none", hot && "text-red-600 dark:text-red-400")}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
