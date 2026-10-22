import { AlertCircle, ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ChatMessage } from "@/components/chat";
import { Button, ChatSkeleton, PageBody } from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBusiness } from "@/lib/data";
import { t, uiLang } from "@/lib/i18n";
import { getLanguage } from "@/lib/language";
import { lastEventOf, listOnboardingMessages, listOnboardingSteps } from "@/lib/onboarding/data";
import { cn } from "@/lib/utils";
import { CHAT_H } from "../_chat/chat-height";
import { finishInterview, retryOnboarding, sendInterviewMessage } from "./actions";
import { PendingButton } from "./chat-form";
import { InterviewChat } from "./interview-chat";

type Params = { params: Promise<{ id: string }> };

/** The interview fills the viewport under the top bar in the 708px reading column. */
const FRAME = cn(CHAT_H, "flex flex-col px-0 pt-0 pb-0 sm:px-0 sm:pt-0");

export default function OnboardingPage(props: Params) {
  return (
    <Suspense
      fallback={
        <PageBody className={FRAME}>
          <div className="h-11 shrink-0 border-b border-border" />
          <ChatSkeleton className="px-4" />
        </PageBody>
      }
    >
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
  const hint = done ? t(lang, "onboarding.doneHint") : `${t(lang, "onboarding.hint")}${userAnswers < 2 ? t(lang, "onboarding.hintFinish") : ""}`;

  // Attach each tool step to the first interviewer reply written after it.
  let s = 0;
  const messages: ChatMessage[] = rows.map((m) => {
    if (m.role === "user") return { id: m.id, role: "user", content: m.content };
    const mine: string[] = [];
    while (s < steps.length && steps[s].createdAt <= m.createdAt) mine.push(steps[s++].message);
    return { id: m.id, role: "assistant", content: m.content, steps: mine };
  });

  return (
    <PageBody className={FRAME}>
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-base leading-6 font-semibold text-foreground">{t(lang, "onboarding.title", { name: biz.name })}</h1>
          <span className="hidden shrink-0 text-xs text-tertiary sm:inline">{t(lang, "onboarding.language", { language: getLanguage(biz.language).nativeLabel })}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={hint} className="shrink-0 self-center rounded-sm text-tertiary transition-colors duration-100 hover:text-foreground">
                <Info aria-hidden className="size-3.5" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{hint}</TooltipContent>
          </Tooltip>
        </div>
        {done ? (
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/b/${id}/${biz.status === "active" ? "profile" : "team"}`}>
              {biz.status === "active" ? t(lang, "interview.seeProfile") : t(lang, "interview.seeTeam")}
              <ArrowRight />
            </Link>
          </Button>
        ) : (
          userAnswers >= 2 &&
          !biz.busy && (
            <form action={finishInterview.bind(null, id)} className="shrink-0">
              <PendingButton>{t(lang, "onboarding.finish")}</PendingButton>
            </form>
          )
        )}
      </header>

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
        <div className="px-4 pb-3">
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive-soft p-3 text-[13px] leading-5">
            <AlertCircle aria-hidden className="size-4 shrink-0 text-destructive" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 text-foreground">{t(lang, "onboarding.failed", { message: last?.message.slice(0, 300) ?? "" })}</span>
            <form action={retryOnboarding.bind(null, id, failedJob)}>
              <PendingButton variant="secondary">{t(lang, "onboarding.retry")}</PendingButton>
            </form>
          </div>
        </div>
      )}
    </PageBody>
  );
}
