import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ChatMessage } from "@/components/chat";
import { PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { t, uiLang } from "@/lib/i18n";
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
  const lang = uiLang(biz.language);
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
          <h1 className="text-lg font-semibold tracking-tight">{t(lang, "onboarding.title", { name: biz.name })}</h1>
          <p className="text-xs text-muted-foreground">{t(lang, "onboarding.language", { language: getLanguage(biz.language).nativeLabel })}</p>
          <p className="text-xs text-muted-foreground">
            {done
              ? t(lang, "onboarding.doneHint")
              : `${t(lang, "onboarding.hint")}${userAnswers < 2 ? t(lang, "onboarding.hintFinish") : ""}`}
          </p>
        </div>
        {done ? (
          <Link href={`/b/${id}/${biz.status === "active" ? "profile" : "team"}`} className="text-sm font-medium text-primary hover:underline">
            {biz.status === "active" ? t(lang, "onboarding.seeProfile") : t(lang, "onboarding.seeTeam")}
          </Link>
        ) : (
          userAnswers >= 2 &&
          !biz.busy && (
            <form action={finishInterview.bind(null, id)}>
              <PendingButton>{t(lang, "onboarding.finish")}</PendingButton>
            </form>
          )
        )}
      </div>

      <InterviewChat
        businessId={id}
        messages={messages}
        busy={biz.busy}
        busyLabel={
          finalizing
            ? t(lang, done ? "onboarding.updatingProfile" : "onboarding.writingProfile")
            : t(lang, rows.length === 0 ? "onboarding.researching" : "onboarding.thinking")
        }
        canSend={!failedJob}
        sendAction={sendInterviewMessage.bind(null, id)}
      />

      {failedJob && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 p-3 text-sm">
          <span className="text-destructive">{t(lang, "onboarding.failed", { message: last?.message.slice(0, 300) ?? "" })}</span>
          <form action={retryOnboarding.bind(null, id, failedJob)}>
            <PendingButton variant="secondary">{t(lang, "onboarding.retry")}</PendingButton>
          </form>
        </div>
      )}
    </div>
  );
}
