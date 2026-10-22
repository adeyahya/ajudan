"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Chat, type ChatMessage } from "@/components/chat";
import { useT } from "@/components/i18n";
import { ChatSkeleton } from "@/components/kit";
import { LiveRefresh, useActivity } from "@/components/live";

/** The interviewer's avatar: a sparkle in a soft blue tile (it isn't a teammate, so no chibi). */
function InterviewerAvatar() {
  return (
    <span aria-hidden className="flex size-7 items-center justify-center rounded-md bg-primary-soft text-primary">
      <Sparkles className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** The interview thread with live "what the interviewer is doing" steps. */
export function InterviewChat({
  businessId,
  messages,
  busy,
  busyLabel,
  canSend,
  sendAction,
}: {
  businessId: string;
  messages: ChatMessage[];
  busy: boolean;
  busyLabel: string;
  canSend: boolean;
  sendAction: (text: string) => Promise<void>;
}) {
  const t = useT();
  const [live, setLive] = useState<{ after: number; steps: string[] }>({ after: messages.length, steps: [] });
  useActivity(businessId, (e) => {
    if (e.type !== "onboarding_tool") return;
    setLive((prev) =>
      prev.after === messages.length ? { after: prev.after, steps: [...prev.steps, e.message] } : { after: messages.length, steps: [e.message] },
    );
  });
  const liveSteps = live.after === messages.length ? live.steps : [];

  return (
    <>
      <LiveRefresh businessId={businessId} types={["onboarding_reply", "onboarding_error", "profile_ready", "profile_updated", "team_proposed"]} />
      <Chat
        className="flex-1"
        agent={{ id: "interviewer", name: t("onboarding.interviewer"), color: "var(--primary)", avatar: <InterviewerAvatar /> }}
        messages={messages}
        busy={busy}
        busyLabel={busyLabel}
        liveSteps={liveSteps}
        sendAction={canSend ? sendAction : undefined}
        placeholder={t("onboarding.placeholder")}
        // Before the first question lands: the thread's shape (its own composer bar hidden; the real one is below).
        emptyState={<ChatSkeleton className="w-full max-w-3xl self-stretch [&>*:last-child]:hidden" />}
      />
    </>
  );
}
