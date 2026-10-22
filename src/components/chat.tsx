"use client";

import {
  AlertCircleIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  FileIcon,
  GlobeIcon,
  LoaderCircleIcon,
  MusicIcon,
  PaperclipIcon,
  SearchIcon,
  UploadIcon,
  VideoIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { useT, useTn } from "@/components/i18n";
import { ImageStrip, fileUrl } from "@/components/image-strip";
import { Avatar, Button, IconButton } from "@/components/kit";
import { Markdown } from "@/components/markdown";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { MessageKey, Vars } from "@/lib/i18n";
import { MEDIA_ACCEPT, mediaKind } from "@/lib/media-types";
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Files sent with the message (folder-relative paths). */
  attachments?: string[];
  /** Small line next to the name, e.g. "Scheduled · 09:00". */
  meta?: string;
  /** Tool steps the assistant took for this message (shown collapsed). */
  steps?: string[];
  /** Content under an assistant reply that always shows (suggestion cards, delegations, images). */
  extras?: ReactNode;
  /**
   * Actions under an assistant reply (status, cost, View work, Retry). Revealed on hover or
   * keyboard focus once the reply is done; always shown while pending or on an error.
   */
  footer?: ReactNode;
  /** Shown in place of content while the assistant works on this message. */
  pending?: boolean;
  error?: boolean;
};

/** `avatar` replaces the chibi portrait (e.g. the interviewer's icon tile). */
export type ChatAgent = { id?: string; name: string; color: string; subtitle?: string; avatar?: ReactNode };

/** A file being uploaded (or uploaded) for the next message. */
type Upload = { key: string; name: string; progress: number; path?: string; error?: string };

/** Hover-revealed on devices that hover; always visible on touch. Opacity keeps it tabbable and the layout still. */
const REVEAL =
  "transition-opacity duration-100 motion-reduce:transition-none pointer-fine:opacity-0 pointer-fine:group-hover/turn:opacity-100 pointer-fine:group-focus-within/turn:opacity-100";

/**
 * A conversation thread (UI-PLAN §2.5): agent turns are avatar + name + markdown with no
 * box, owner turns are right-aligned grey bubbles, and the composer sits under the thread.
 * Message Scroller keeps the latest turn in view. `?compose=1` in the URL focuses the composer
 * (the palette's "Give a task" lands here) and is removed from the URL.
 */
export function Chat({
  agent,
  messages,
  busy,
  busyLabel,
  liveSteps = [],
  sendAction,
  uploadBusinessId,
  placeholder,
  suggestions = [],
  emptyState,
  inputDisabled,
  className,
}: {
  agent: ChatAgent;
  messages: ChatMessage[];
  busy: boolean;
  busyLabel?: string;
  /** Live tool steps for the in-progress reply. */
  liveSteps?: string[];
  /** Server Function that receives the typed text and attached file paths. */
  sendAction?: (text: string, attachments: string[]) => Promise<void>;
  /** Lets the owner drop or pick files (uploaded to this business's media library). */
  uploadBusinessId?: string;
  placeholder?: string;
  /** Up to three starter prompts above the composer, until the first message. */
  suggestions?: string[];
  emptyState?: ReactNode;
  inputDisabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (state, m: { text: string; attachments: string[] }) => [
      ...state,
      { id: `optimistic-${state.length}`, role: "user" as const, content: m.text, attachments: m.attachments },
    ],
  );
  const [sending, startSending] = useTransition();
  const showThinking = busy || sending;
  // The scroll anchor: your latest message, or the newest one if you haven't written yet
  // (with no anchor at all the scroller stays hidden).
  const lastUserId = optimistic.findLast((m) => m.role === "user")?.id ?? optimistic.at(-1)?.id;
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const send = (text: string) => {
    const attachments = uploads.flatMap((u) => (u.path ? [u.path] : []));
    if (!sendAction || (!text.trim() && !attachments.length)) return;
    const body = text.trim() || t("chat.seeAttached");
    setUploads([]);
    startSending(async () => {
      addOptimistic({ text: body, attachments });
      await sendAction(body, attachments);
    });
  };

  const addFiles = (files: FileList | File[]) => {
    if (!uploadBusinessId) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      const patch = (v: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...v } : x)));
      uploadFile(uploadBusinessId, file, (progress) => patch({ progress }), t)
        .then((path) => patch({ path, progress: 1 }))
        .catch((err: Error) => patch({ error: err.message }));
    }
  };

  const dropProps = uploadBusinessId
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        },
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        },
      }
    : {};

  return (
    <div className={cn("relative flex min-h-0 flex-col", className)} {...dropProps}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 bg-background/85 p-2">
          <div className="flex size-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ring bg-primary-soft text-center">
            <UploadIcon aria-hidden className="size-5 text-primary" strokeWidth={1.75} />
            <p className="text-sm leading-5 font-semibold text-foreground">{t("chat.dropTo", { name: agent.name })}</p>
            <p className="text-xs text-muted-foreground">{t("chat.dropBody", { name: agent.name })}</p>
          </div>
        </div>
      )}
      {optimistic.length === 0 && !showThinking ? (
        // The scroller hides itself until it has an item to anchor to.
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-4">{emptyState}</div>
      ) : (
        <MessageScrollerProvider autoScroll>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-0 px-4 pt-4 pb-6">
                {optimistic.map((m) => (
                  // Only the latest user turn is an anchor. When the optimistic message is
                  // swapped for the saved one, the scroller jumps to the first anchor it hasn't
                  // scrolled to yet, which would be the oldest message if every turn were one.
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.id === lastUserId}>
                    {m.role === "user" ? <UserTurn m={m} businessId={uploadBusinessId} /> : <AgentTurn m={m} agent={agent} />}
                  </MessageScrollerItem>
                ))}
                {showThinking && (
                  <MessageScrollerItem messageId="thinking">
                    <AgentTurn
                      agent={agent}
                      m={{ id: "thinking", role: "assistant", content: "", pending: true, steps: liveSteps, meta: busyLabel ?? t("chat.thinking") }}
                    />
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      {sendAction && (
        <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pt-1 pb-3">
          {suggestions.length > 0 && optimistic.length === 0 && !showThinking && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.slice(0, 3).map((s) => (
                <Button key={s} variant="secondary" size="sm" className="h-7 max-w-full rounded-full px-3 font-normal" onClick={() => send(s)}>
                  <span className="truncate">{s}</span>
                </Button>
              ))}
            </div>
          )}
          <PromptInput
            disabled={inputDisabled || showThinking}
            placeholder={showThinking ? t("chat.isWorking", { name: agent.name }) : placeholder}
            onSubmit={send}
            uploads={uploads}
            businessId={uploadBusinessId}
            onAddFiles={uploadBusinessId ? addFiles : undefined}
            onRemoveUpload={(key) => setUploads((u) => u.filter((x) => x.key !== key))}
          />
        </div>
      )}
    </div>
  );
}

function UserTurn({ m, businessId }: { m: ChatMessage; businessId?: string }) {
  return (
    <div data-slot="message" className="group/turn flex flex-col items-end gap-1 py-2">
      {m.meta && <div className={cn("max-w-[75%] truncate text-xs text-tertiary", REVEAL)}>{m.meta}</div>}
      {businessId && m.attachments && m.attachments.length > 0 && (
        <ImageStrip businessId={businessId} images={m.attachments} size={72} className="max-w-[75%] justify-end" />
      )}
      <div className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm leading-[22px] whitespace-pre-wrap text-foreground wrap-break-word sm:max-w-[75%]">
        {m.content}
      </div>
    </div>
  );
}

function AgentTurn({ m, agent }: { m: ChatMessage; agent: ChatAgent }) {
  const t = useT();
  return (
    <div data-slot="message" className="group/turn grid grid-cols-[28px_minmax(0,1fr)] gap-3 py-3">
      <div className="pt-px">{agent.avatar ?? <Avatar seed={agent.id} name={agent.name} color={agent.color} size={28} />}</div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-1.5 text-[13px] leading-[18px]">
          <span className="shrink-0 font-semibold text-foreground">{agent.name}</span>
          {m.meta && !m.pending && <span className="truncate text-xs text-tertiary">{m.meta}</span>}
        </div>
        {m.pending ? (
          <>
            <LiveTrace steps={m.steps ?? []} label={m.meta ?? t("chat.thinking")} />
            {m.footer && <div className="flex flex-wrap items-center gap-1">{m.footer}</div>}
          </>
        ) : (
          <>
            {m.steps && m.steps.length > 0 && <StepsTrace steps={m.steps} />}
            {m.content && (
              <div className={cn("min-w-0", m.error && "text-destructive")}>
                <Markdown>{m.content}</Markdown>
              </div>
            )}
            {m.extras && <div className="flex flex-col gap-2 pt-1">{m.extras}</div>}
            {(m.content || m.footer) && (
              <div className={cn("-ml-1.5 flex min-h-7 flex-wrap items-center gap-1 text-xs text-tertiary", !m.error && REVEAL)}>
                {m.content && <CopyButton text={m.content} />}
                {m.footer}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function stepIcon(step: string) {
  if (step.startsWith("Searching")) return <SearchIcon />;
  if (step.startsWith("Reading http") || step.startsWith("Reading www")) return <GlobeIcon />;
  return <WrenchIcon />;
}

/** The in-progress reply: latest steps with a shimmer on the current one. */
function LiveTrace({ steps, label }: { steps: string[]; label: string }) {
  const recent = steps.slice(-4);
  return (
    <Trace className="text-[13px]">
      {recent.map((s, i) => (
        <div key={`${i}-${s}`}>
          <TraceLine status={i === recent.length - 1 ? "running" : undefined}>
            <TraceIcon>{stepIcon(s)}</TraceIcon>
            <TraceTitle>{s}</TraceTitle>
          </TraceLine>
        </div>
      ))}
      <div>
        <TraceLine status="running">
          <TraceIcon>
            <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
          </TraceIcon>
          <TraceTitle>{label}</TraceTitle>
        </TraceLine>
      </div>
    </Trace>
  );
}

/** Finished reply: steps folded into one line ("Worked through 6 steps"). */
function StepsTrace({ steps }: { steps: string[] }) {
  const tn = useTn();
  return (
    <Trace className="text-[13px]">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <CheckIcon />
            </TraceIcon>
            <TraceTitle>{tn("chat.workedSteps", steps.length)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="mt-1.5 ml-2 flex flex-col gap-1.5 border-l border-border pl-3">
            {steps.map((s, i) => (
              <TraceLine key={`${i}-${s}`}>
                <TraceIcon>{stepIcon(s)}</TraceIcon>
                <TraceTitle>{s}</TraceTitle>
              </TraceLine>
            ))}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <IconButton
      label={copied ? t("chat.copied") : t("chat.copy")}
      side="top"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}

/** Upload one file to the business's media library; resolves to its folder-relative path. */
function uploadFile(businessId: string, file: File, onProgress: (p: number) => void, t: (key: MessageKey, vars?: Vars) => string) {
  return new Promise<string>((resolve, reject) => {
    // XHR, not fetch: it reports upload progress (footage can be big).
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/b/${businessId}/media`);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { path?: string; error?: string };
        if (xhr.status < 300 && body.path) resolve(body.path);
        else reject(new Error(body.error ?? t("chat.uploadFailed", { status: xhr.status })));
      } catch {
        reject(new Error(t("chat.uploadFailed", { status: xhr.status })));
      }
    };
    xhr.onerror = () => reject(new Error(t("chat.uploadFailedNetwork")));
    xhr.send(file);
  });
}

/** 36px chip for a file attached to the next message: thumb, name, a 2px progress line. */
function UploadChip({ u, businessId, onRemove }: { u: Upload; businessId?: string; onRemove: () => void }) {
  const kind = mediaKind(u.name);
  const Icon = kind === "video" ? VideoIcon : kind === "audio" ? MusicIcon : FileIcon;
  const t = useT();
  const status = u.error ?? (u.path ? t("chat.ready") : t("chat.uploading", { pct: Math.round(u.progress * 100) }));
  return (
    <div
      className={cn(
        "relative flex h-9 max-w-52 items-center gap-2 overflow-hidden rounded-md border border-border bg-muted pr-1 pl-1",
        u.error && "border-destructive/40 bg-destructive-soft",
      )}
      title={`${u.name} · ${status}`}
    >
      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-background text-tertiary">
        {u.error ? (
          <AlertCircleIcon className="size-4 text-destructive" />
        ) : kind === "image" && u.path && businessId ? (
          // eslint-disable-next-line @next/next/no-img-element -- local upload preview
          <img src={fileUrl(businessId, u.path)} alt="" className="size-full object-cover" />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-xs text-foreground", u.error && "text-destructive")}>{u.name}</span>
      <span className="sr-only">{status}</span>
      {!u.path && !u.error && (
        <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width] duration-150" style={{ width: `${u.progress * 100}%` }} />
      )}
      <IconButton label={t("chat.removeFile", { name: u.name })} size="icon-xs" side="top" onClick={onRemove}>
        <XIcon />
      </IconButton>
    </div>
  );
}

/**
 * `?compose=1` (the palette's "Give a task", the conversation list's "+") asks for the
 * composer: true once, and the param leaves the URL (native replaceState, which the Next
 * router follows).
 */
function takeCompose() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("compose") !== "1") return false;
  url.searchParams.delete("compose");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return true;
}

/** Re-checks `?compose=1` on client navigations (e.g. the palette while already on this chat). */
function ComposeWatcher({ onCompose }: { onCompose: () => void }) {
  const compose = useSearchParams().get("compose") === "1";
  useEffect(() => {
    if (compose && takeCompose()) onCompose();
  }, [compose, onCompose]);
  return null;
}

/** Message field: Enter sends, Shift+Enter adds a line. Files can be picked, dropped or pasted. */
function PromptInput({
  onSubmit,
  disabled,
  placeholder,
  uploads,
  businessId,
  onAddFiles,
  onRemoveUpload,
}: {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  uploads: Upload[];
  businessId?: string;
  onAddFiles?: (files: FileList | File[]) => void;
  onRemoveUpload: (key: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = uploads.some((u) => !u.path && !u.error);
  const ready = uploads.some((u) => u.path);
  const canSend = !disabled && !uploading && (text.trim().length > 0 || ready);
  const submit = () => {
    if (!canSend) return;
    onSubmit(text);
    setText("");
  };

  // ?compose=1 on a full page load: focus once mounted (client navigations go through ComposeWatcher).
  useEffect(() => {
    if (takeCompose()) ref.current?.focus();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* useSearchParams in its own boundary, so it never holds up the composer's hydration. */}
      <Suspense fallback={null}>
        <ComposeWatcher onCompose={() => ref.current?.focus()} />
      </Suspense>
      {/* The group dims on any disabled child; only a disabled field should dim it, not the empty-state send button. */}
      <InputGroup className="rounded-lg bg-background hover:border-border-strong has-disabled:bg-background has-disabled:opacity-100 has-[textarea:disabled]:bg-muted has-[textarea:disabled]:opacity-70">
        {uploads.length > 0 && (
          <InputGroupAddon align="block-start" className="flex flex-wrap gap-1.5">
            {uploads.map((u) => (
              <UploadChip key={u.key} u={u} businessId={businessId} onRemove={() => onRemoveUpload(u.key)} />
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={ref}
          data-composer
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (onAddFiles && e.clipboardData.files.length) {
              e.preventDefault();
              onAddFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          aria-label={placeholder ?? t("chat.send")}
          placeholder={placeholder}
          disabled={disabled}
          className="max-h-48 min-h-11 px-3 pt-2.5 text-sm leading-[22px]"
        />
        <InputGroupAddon align="block-end" className="justify-between px-1.5 pb-1.5">
          <div className="flex items-center gap-1">
            {onAddFiles && (
              <>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  accept={MEDIA_ACCEPT}
                  className="hidden"
                  tabIndex={-1}
                  onChange={(e) => {
                    if (e.target.files?.length) onAddFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <IconButton type="button" label={t("chat.attachTitle")} side="top" onClick={() => picker.current?.click()}>
                  <PaperclipIcon />
                </IconButton>
              </>
            )}
          </div>
          <IconButton type="submit" variant="primary" label={t("chat.send")} shortcut="↵" side="top" disabled={!canSend}>
            <ArrowUpIcon />
          </IconButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
