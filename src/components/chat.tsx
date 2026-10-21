"use client";

import { ArrowUpIcon, CheckIcon, CopyIcon, GlobeIcon, LoaderCircleIcon, SearchIcon, WrenchIcon } from "lucide-react";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
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
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Small line above the message, e.g. "from schedule · 09:00". */
  meta?: string;
  /** Tool steps the assistant took for this message (shown collapsed). */
  steps?: string[];
  /** Extra UI under an assistant message (badges, actions). */
  footer?: ReactNode;
  /** Shown in place of content while the assistant works on this message. */
  pending?: boolean;
  error?: boolean;
};

export type ChatAgent = { id?: string; name: string; color: string; subtitle?: string };

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
  /** Server Function that receives the typed text. */
  sendAction?: (text: string) => Promise<void>;
  placeholder?: string;
  suggestions?: string[];
  emptyState?: ReactNode;
  inputDisabled?: boolean;
  className?: string;
}) {
  const [optimistic, addOptimistic] = useOptimistic(messages, (state, text: string) => [
    ...state,
    { id: `optimistic-${state.length}`, role: "user" as const, content: text },
  ]);
  const [sending, startSending] = useTransition();
  const showThinking = busy || sending;

  const send = (text: string) => {
    if (!sendAction || !text.trim()) return;
    startSending(async () => {
      addOptimistic(text.trim());
      await sendAction(text.trim());
    });
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {optimistic.length === 0 && !showThinking ? (
        // The scroller hides itself until it has an item to anchor to.
        <div className="flex flex-1 items-center justify-center overflow-y-auto">{emptyState}</div>
      ) : (
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl px-1 pt-2 pb-6">
              {optimistic.map((m) => (
                <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                  {m.role === "user" ? <UserTurn m={m} /> : <AgentTurn m={m} agent={agent} />}
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
          />
        </div>
      )}
    </div>
  );
}

function UserTurn({ m }: { m: ChatMessage }) {
  return (
    <Message align="end">
      <MessageContent>
        {m.meta && <MessageHeader className="font-pixel justify-end text-xs text-muted-foreground">{m.meta}</MessageHeader>}
        <Bubble align="end" variant="ghost">
          {/* Owner's lines: a parchment speech card. */}
          <BubbleContent className="pixel-paper whitespace-pre-wrap px-3 py-2">{m.content}</BubbleContent>
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
          <LiveTrace steps={m.steps ?? []} label={m.meta ?? "Thinking…"} />
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

/** Message field: Enter sends, Shift+Enter adds a line. */
function PromptInput({
  onSubmit,
  disabled,
  placeholder,
}: {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && text.trim().length > 0;
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
        <InputGroupTextarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
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
          <span className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
          <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" disabled={!canSend} aria-label="Send">
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
