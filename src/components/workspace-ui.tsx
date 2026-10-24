"use client";

import { Ellipsis } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/components/i18n";
import { Button, cn, PageBody, PageHeader } from "@/components/kit";
import { SidePeekLayout } from "@/components/side-peek";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MessageKey } from "@/lib/i18n";

/**
 * Shared frame and small controls for the workspace pages (Docs, Library, Contacts, Home,
 * Trash) and the Studio editors.
 */

/**
 * A workspace page's frame: a title (with optional actions on its right) and the page
 * below. Pages that open records on the side pass `peek` (a <SidePeek>), which sits beside
 * the page column. Focus mode (src/components/doc-layout.tsx) hides the title.
 */
export function WorkspaceShell({ title, actions, peek, children }: { title: ReactNode; actions?: ReactNode; peek?: ReactNode; children: ReactNode }) {
  const body = (
    <PageBody width="full">
      <div data-focus-hide>
        <PageHeader className="mb-5" title={title} actions={actions} />
      </div>
      <div className="@container">{children}</div>
    </PageBody>
  );
  return peek ? <SidePeekLayout peek={peek}>{body}</SidePeekLayout> : body;
}

/**
 * The workspace and Studio actions (and planTask in src/app/b/[id]/actions.ts) answer in
 * English: show their known messages in the UI language, anything else as it came.
 */
const ACTION_ERRORS: Record<string, MessageKey> = {
  "Pick a teammate.": "studio.err.pickTeammate",
  "Say what you'd like done.": "studio.err.sayWhat",
  "Give the doc a title.": "studio.err.docTitle",
  "Doc not found": "studio.err.docNotFound",
  "Edit not found": "studio.err.editNotFound",
};
export function localizeError(t: (key: MessageKey) => string, message: string | undefined) {
  if (!message) return message;
  const key = ACTION_ERRORS[message];
  return key ? t(key) : message;
}

/** A small segmented control (Write/Preview, Fill/Fit): grey track, white active pill. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex h-7 items-center rounded-md bg-secondary p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-6 flex-1 items-center justify-center rounded-[5px] px-2.5 text-[13px] leading-[18px] font-medium whitespace-nowrap transition-colors duration-100 motion-reduce:transition-none",
            value === o.value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A controlled "Delete …?" AlertDialog, for delete items that live in a "…" menu. */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  body,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  body?: ReactNode;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {body && <AlertDialogDescription>{body}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive! text-white hover:bg-destructive/90! focus-visible:outline-destructive">
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A labelled control row for the editors' inspector columns (Notion property style). */
export function PropRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2", className)}>
      <span className="truncate text-[13px] leading-[18px] text-tertiary">{label}</span>
      <div className="flex min-h-8 min-w-0 items-center gap-2 text-[13px]">{children}</div>
    </div>
  );
}

/** A "…" icon button (with tooltip) that opens a menu of DropdownMenuItems. */
export function MoreMenu({
  label,
  children,
  className,
  size = "icon-sm",
  disabled,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  size?: "icon-xs" | "icon-sm";
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size={size}
              aria-label={label}
              disabled={disabled}
              className={cn("text-tertiary hover:text-foreground aria-expanded:text-foreground", className)}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
