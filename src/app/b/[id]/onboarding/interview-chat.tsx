"use client";

import { useState } from "react";
import { Chat, type ChatMessage } from "@/components/chat";
import { useT } from "@/components/i18n";
import { LiveRefresh, useActivity } from "@/components/live";

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
        agent={{ id: "interviewer", name: t("onboarding.interviewer"), color: "#3f7d74" }}
        messages={messages}
        busy={busy}
        busyLabel={busyLabel}
        liveSteps={liveSteps}
        sendAction={canSend ? sendAction : undefined}
        placeholder={t("onboarding.placeholder")}
        emptyState={<p className="py-10 text-center text-sm text-muted-foreground">{t("onboarding.starting")}</p>}
      />
    </>
  );
}
