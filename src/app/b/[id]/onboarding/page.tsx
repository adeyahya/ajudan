import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ChatMessage } from "@/components/chat";
import { PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { getLanguage } from "@/lib/language";
import { lastEventOf, listOnboardingMessages, listOnboardingSteps } from "@/lib/onboarding/data";
import { finishInterview, retryOnboarding, sendInterviewMessage } from "./actions";
import { PendingButton } from "./chat-form";
import { InterviewChat } from "./interview-chat";

type Params = { params: Promise<{ id: string }> };

export default function OnboardingPage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: Params) {
  const { id } = await params;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const [rows, steps, last] = await Promise.all([
    listOnboardingMessages(id),
    listOnboardingSteps(id),
    lastEventOf(id, ["onboarding_reply", "onboarding_error", "profile_ready", "profile_updated"]),
  ]);
  const userAnswers = rows.filter((m) => m.role === "user").length;
  const failedJob = !biz.busy && last?.type === "onboarding_error" ? ((last.data?.job as "turn" | "finalize") ?? "turn") : null;
  const done = biz.status !== "onboarding";
  const finalizing = biz.busy && userAnswers >= 2 && rows.at(-1)?.role === "assistant";

  // Attach each tool step to the first interviewer reply written after it.
  let s = 0;
  const messages: ChatMessage[] = rows.map((m) => {
    if (m.role === "user") return { id: m.id, role: "user", content: m.content };
    const mine: string[] = [];
    while (s < steps.length && steps[s].createdAt <= m.createdAt) mine.push(steps[s++].message);
    return { id: m.id, role: "assistant", content: m.content, steps: mine };
  });

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.75rem)] max-w-3xl flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Interview · {biz.name}</h1>
          <p className="text-xs text-muted-foreground">Language: {getLanguage(biz.language).nativeLabel}</p>
          <p className="text-xs text-muted-foreground">
            {done
              ? "Interview complete. Keep adding details here any time: each message updates your business profile."
              : `Your interviewer uses these answers to design your AI team.${userAnswers < 2 ? " Answer a couple of questions to finish any time." : ""}`}
          </p>
        </div>
        {done ? (
          <Link href={`/b/${id}/${biz.status === "active" ? "profile" : "team"}`} className="text-sm font-medium text-primary hover:underline">
            {biz.status === "active" ? "See your business profile →" : "See your team →"}
          </Link>
        ) : (
          userAnswers >= 2 &&
          !biz.busy && (
            <form action={finishInterview.bind(null, id)}>
              <PendingButton>Finish interview</PendingButton>
            </form>
          )
        )}
      </div>

      <InterviewChat
        businessId={id}
        messages={messages}
        busy={biz.busy}
        busyLabel={
          finalizing ? (done ? "Updating your business profile…" : "Writing your business profile…") : rows.length === 0 ? "Researching your business…" : "Thinking…"
        }
        canSend={!failedJob}
        sendAction={sendInterviewMessage.bind(null, id)}
      />

      {failedJob && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 p-3 text-sm">
          <span className="text-destructive">Something went wrong: {last?.message.slice(0, 300)}</span>
          <form action={retryOnboarding.bind(null, id, failedJob)}>
            <PendingButton variant="secondary">Retry</PendingButton>
          </form>
        </div>
      )}
    </div>
  );
}
