"use client";

import {
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
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { ImageStrip, fileUrl } from "@/components/image-strip";
import { Avatar } from "@/components/kit";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
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
import { MEDIA_ACCEPT, mediaKind } from "@/lib/media-types";
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Files sent with the message (folder-relative paths). */
  attachments?: string[];
  /** Small line above the message, e.g. "from schedule · 09:00". */
  meta?: string;
  /** Tool steps the assistant took for this message (shown collapsed). */
  steps?: string[];
  /** Extra UI under an assistant message (badges, actions); under the trace while pending. */
  footer?: ReactNode;
  /** Shown in place of content while the assistant works on this message. */
  pending?: boolean;
  error?: boolean;
};

export type ChatAgent = { id?: string; name: string; color: string; subtitle?: string };

/** A file being uploaded (or uploaded) for the next message. */
type Upload = { key: string; name: string; progress: number; path?: string; error?: string };

/**
 * Chat thread built from shadcn AI Elements: Message Scroller keeps the latest turn in
 * view, user turns are bubbles, agent turns are markdown with a collapsible trace.
 */
export function Chat({
  agent,
  messages,
  busy,
  busyLabel = "Thinking…",
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
  suggestions?: string[];
  emptyState?: ReactNode;
  inputDisabled?: boolean;
  className?: string;
}) {
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
    const body = text.trim() || "(See the attached files.)";
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
      uploadFile(uploadBusinessId, file, (progress) => patch({ progress }))
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
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/80">
          <div className="pixel-panel flex flex-col items-center gap-2 px-8 py-6 text-center">
            <UploadIcon className="size-8 text-primary" />
            <p className="font-pixel">Drop files to attach</p>
            <p className="text-xs text-muted-foreground">Footage, photos, music or documents for {agent.name}</p>
          </div>
        </div>
      )}
      {optimistic.length === 0 && !showThinking ? (
        // The scroller hides itself until it has an item to anchor to.
        <div className="flex flex-1 items-center justify-center overflow-y-auto">{emptyState}</div>
      ) : (
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl px-1 pt-2 pb-6">
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
                    m={{ id: "thinking", role: "assistant", content: "", pending: true, steps: liveSteps, meta: busyLabel }}
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
        <div className="mx-auto w-full max-w-3xl space-y-2 pt-2">
          {suggestions.length > 0 && !showThinking && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <Button key={s} variant="outline" size="sm" className="rounded-full font-normal" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          )}
          <PromptInput
            disabled={inputDisabled || showThinking}
            placeholder={showThinking ? `${agent.name} is working…` : placeholder}
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
    <Message align="end">
      <MessageContent>
        {m.meta && <MessageHeader className="font-pixel justify-end text-xs text-muted-foreground">{m.meta}</MessageHeader>}
        {businessId && m.attachments && m.attachments.length > 0 && (
          <ImageStrip businessId={businessId} images={m.attachments} size={72} className="justify-end" />
        )}
        <Bubble align="end" variant="ghost">
          {/* Owner's lines: a parchment speech card. */}
          {/* `!` beats the ghost variant's transparent background and zero padding. */}
          <BubbleContent className="pixel-paper whitespace-pre-wrap bg-parchment! px-3! py-2! text-ink!">{m.content}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function AgentTurn({ m, agent }: { m: ChatMessage; agent: ChatAgent }) {
  return (
    // RPG dialogue box: portrait on the left, a name plate, then the text.
    <Message className="flex-row items-start gap-3">
      <div className="hidden shrink-0 pt-4 sm:block">
        <Avatar seed={agent.id} name={agent.name} color={agent.color} size={44} />
      </div>
      <MessageContent className="pixel-panel relative min-w-0 flex-1 gap-2 px-4 pb-3 pt-5">
        <MessageHeader className="absolute -top-3 left-3 flex items-center gap-2 px-0">
          <span className="font-pixel bg-primary px-2 py-0.5 text-sm text-primary-foreground shadow-[-2px_0_0_var(--frame),2px_0_0_var(--frame),0_-2px_0_var(--frame),0_2px_0_var(--frame)]">
            {agent.name}
          </span>
          {m.meta && !m.pending && (
            <span className="font-pixel bg-card px-1.5 text-[11px] text-muted-foreground">{m.meta}</span>
          )}
        </MessageHeader>
        {m.pending ? (
          <>
            <LiveTrace steps={m.steps ?? []} label={m.meta ?? "Thinking…"} />
            {m.footer && <MessageFooter className="flex flex-wrap items-center gap-2">{m.footer}</MessageFooter>}
          </>
        ) : (
          <>
            {m.steps && m.steps.length > 0 && <StepsTrace steps={m.steps} />}
            {m.content && (
              <div className={cn(m.error && "text-destructive")}>
                <Markdown>{m.content}</Markdown>
              </div>
            )}
            <MessageFooter className="flex flex-wrap items-center gap-2">
              {m.content && <CopyButton text={m.content} />}
              {m.footer}
            </MessageFooter>
          </>
        )}
      </MessageContent>
    </Message>
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
    <Trace>
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
            <LoaderCircleIcon className="animate-spin" />
          </TraceIcon>
          <TraceTitle>{label}</TraceTitle>
        </TraceLine>
      </div>
    </Trace>
  );
}

/** Finished reply: steps folded into one line ("Worked through 6 steps"). */
function StepsTrace({ steps }: { steps: string[] }) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <CheckIcon />
            </TraceIcon>
            <TraceTitle>
              Worked through {steps.length} step{steps.length === 1 ? "" : "s"}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-1.5 border-l pl-3 ml-2">
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
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/** Upload one file to the business's media library; resolves to its folder-relative path. */
function uploadFile(businessId: string, file: File, onProgress: (p: number) => void) {
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
        else reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed (network)"));
    xhr.send(file);
  });
}

function UploadChip({ u, businessId, onRemove }: { u: Upload; businessId?: string; onRemove: () => void }) {
  const kind = mediaKind(u.name);
  const Icon = kind === "video" ? VideoIcon : kind === "audio" ? MusicIcon : FileIcon;
  return (
    <div
      className={cn(
        "pixel-frame relative m-[3px] flex h-12 w-44 items-center gap-2 overflow-hidden bg-muted pr-7 text-xs",
        u.error && "text-destructive",
      )}
      title={u.error ?? u.name}
    >
      <div className="flex size-12 shrink-0 items-center justify-center bg-card">
        {kind === "image" && u.path && businessId ? (
          // eslint-disable-next-line @next/next/no-img-element -- local upload preview
          <img src={fileUrl(businessId, u.path)} alt="" className="size-full object-cover" />
        ) : (
          <Icon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate">{u.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {u.error ? "Failed" : u.path ? "Ready" : `Uploading ${Math.round(u.progress * 100)}%`}
        </div>
      </div>
      {!u.path && !u.error && (
        <div className="absolute bottom-0 left-0 h-[3px] bg-primary" style={{ width: `${u.progress * 100}%` }} />
      )}
      <button type="button" onClick={onRemove} className="absolute top-1 right-1 text-muted-foreground hover:text-foreground" aria-label={`Remove ${u.name}`}>
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
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
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <InputGroup className="rounded-2xl bg-card shadow-sm">
        {uploads.length > 0 && (
          <InputGroupAddon align="block-start" className="flex flex-wrap gap-1.5">
            {uploads.map((u) => (
              <UploadChip key={u.key} u={u} businessId={businessId} onRemove={() => onRemoveUpload(u.key)} />
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={ref}
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
          rows={2}
          placeholder={placeholder}
          disabled={disabled}
          className="max-h-48 min-h-12"
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <div className="flex items-center gap-2">
            {onAddFiles && (
              <>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  accept={MEDIA_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) onAddFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => picker.current?.click()}
                  aria-label="Attach files"
                  title="Attach footage, photos or files (or drop them here)"
                >
                  <PaperclipIcon />
                </InputGroupButton>
              </>
            )}
            <span className="text-xs text-muted-foreground">
              Enter to send · Shift+Enter for a new line{onAddFiles ? " · drop files to attach" : ""}
            </span>
          </div>
          <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" disabled={!canSend} aria-label="Send">
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
