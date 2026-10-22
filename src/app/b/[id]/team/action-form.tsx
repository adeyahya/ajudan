"use client";

import { useTransition, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/kit";

/**
 * Small client pieces for server-action forms on the Team, Business, Health and Files
 * pages: a form that toasts when its action finishes (or fails), and a submit button that
 * shows a spinner while the form is pending.
 *
 *   <ActionForm action={hireTeam.bind(null, id)} success={t(lang, "team.toast.hired")}>
 *     <SubmitButton size="sm">{t(lang, "team.hire")}</SubmitButton>
 *   </ActionForm>
 */
export function ActionForm({
  action,
  success,
  className,
  children,
}: {
  action: (fd: FormData) => Promise<unknown>;
  /** Toast shown when the action resolves. */
  success?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      className={className}
      action={async (fd) => {
        try {
          await action(fd);
          if (success) toast.success(success);
        } catch (err) {
          // redirect() inside an action surfaces as a thrown NEXT_REDIRECT: let Next handle it.
          if (isNextControl(err)) throw err;
          toast.error(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      {children}
    </form>
  );
}

/** Submit button with a spinner while its form is pending. */
export function SubmitButton({ children, ...props }: ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending || props.disabled} {...props}>
      {children}
    </Button>
  );
}

/** Run a server action from a click (menu items, switches) with a toast. */
export function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>, success?: string, onDone?: () => void) =>
    start(async () => {
      try {
        await fn();
        if (success) toast.success(success);
        onDone?.();
      } catch (err) {
        if (isNextControl(err)) throw err;
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  return { pending, run };
}

function isNextControl(err: unknown) {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND") || digest === "NEXT_HTTP_ERROR_FALLBACK;404");
}
