"use client";

import { Ellipsis, Pencil, Play, Plus, Trash2, UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useT } from "@/components/i18n";
import { Button, ConfirmDialog, IconButton } from "@/components/kit";
import { SidePeek, useUrlPeek } from "@/components/side-peek";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { runScheduledNow } from "../teammates/[tid]/actions";
import type { AccessKind, FormState } from "./actions";
import { useAction } from "./action-form";
import { AddTeammateForm, FormDialog, HumanForm, SwitchRow, TeammateEditor, type TeammateInitial } from "./forms";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Header action: "Add teammate" → dialog. */
export function AddTeammateDialog({ action, roles }: { action: Action; roles: { key: string; title: string; summary: string }[] }) {
  const t = useT();
  return (
    <FormDialog
      title={t("team.addAiTitle")}
      description={t("team.addAiBody")}
      trigger={
        <Button size="sm">
          <Plus />
          <span className="max-sm:sr-only">{t("team.addTeammate")}</span>
        </Button>
      }
    >
      {(close) => <AddTeammateForm action={action} roles={roles} onSaved={close} />}
    </FormDialog>
  );
}

/** Header action: "Add person" → dialog. */
export function AddPersonDialog({ action, full }: { action: Action; full?: boolean }) {
  const t = useT();
  return (
    <FormDialog
      title={t("team.addPersonTitle")}
      description={t("team.peopleBody")}
      wide
      trigger={
        <Button size="sm" variant="secondary">
          <UserPlus />
          <span className={full ? undefined : "max-sm:sr-only"}>{t("team.addPerson")}</span>
        </Button>
      }
    >
      {(close) => <HumanForm action={action} onSaved={close} />}
    </FormDialog>
  );
}

/** Edit an AI teammate (pencil in the peek, or a ghost button on a proposal card). */
export function EditTeammateDialog({ action, initial, asButton }: { action: Action; initial: TeammateInitial; asButton?: boolean }) {
  const t = useT();
  return (
    <FormDialog
      title={t("team.editTitle", { name: initial.name })}
      wide
      trigger={
        asButton ? (
          <Button size="sm" variant="ghost">
            <Pencil />
            {t("team.edit")}
          </Button>
        ) : (
          <IconButton label={t("team.edit")}>
            <Pencil />
          </IconButton>
        )
      }
    >
      {(close) => <TeammateEditor action={action} initial={initial} onSaved={close} />}
    </FormDialog>
  );
}

/** Edit a person on WhatsApp. */
export function EditPersonDialog({ action, initial }: { action: Action; initial: { name: string; title: string; phone: string | null; helps: string[] } }) {
  const t = useT();
  return (
    <FormDialog
      title={t("team.editTitle", { name: initial.name })}
      wide
      trigger={
        <IconButton label={t("team.edit")}>
          <Pencil />
        </IconButton>
      }
    >
      {(close) => <HumanForm action={action} initial={initial} submitLabel={t("team.form.save")} onSaved={close} />}
    </FormDialog>
  );
}

/**
 * "…" menu with one destructive item (Archive / Remove) behind a confirm. The AlertDialog
 * sits outside the menu so closing the menu doesn't unmount it.
 */
export function RemoveMenu({
  remove,
  itemLabel,
  confirmTitle,
  confirmBody,
  confirmLabel,
  success,
  onDone,
}: {
  remove: () => Promise<unknown>;
  itemLabel: string;
  confirmTitle: string;
  confirmBody?: string;
  confirmLabel: string;
  success: string;
  onDone?: () => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const { pending, run } = useAction();
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton label={t("team.more")}>
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
            <Trash2 />
            {itemLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            {confirmBody && <AlertDialogDescription>{confirmBody}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => run(remove, success, onDone)}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A ghost "Remove" with a confirm (proposal cards). */
export function RemoveButton({ remove, label, confirmTitle, success }: { remove: () => Promise<unknown>; label: string; confirmTitle: string; success: string }) {
  const t = useT();
  const { pending, run } = useAction();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" loading={pending}>
          <Trash2 />
          {label}
        </Button>
      }
      title={confirmTitle}
      confirmLabel={label}
      cancelLabel={t("common.cancel")}
      destructive
      onConfirm={() => run(remove, success)}
    />
  );
}

/** The teammate side peek (`?t=<id>`): the body is rendered on the server. */
export function TeamPeek({ title, openHref, actions, children }: { title?: string; openHref?: string; actions?: ReactNode; children?: ReactNode }) {
  const peek = useUrlPeek("t");
  return (
    <SidePeek open={!!peek.value && !!children} onClose={peek.close} title={title} openHref={openHref} actions={actions}>
      {children}
    </SidePeek>
  );
}

/** Browser / WhatsApp / Shell / Repositories switches that save as you flip them. */
export function AccessSwitches({
  values,
  toggle,
  help,
  labels,
}: {
  values: Record<AccessKind, boolean>;
  toggle: (kind: AccessKind, on: boolean) => Promise<void>;
  labels: Record<AccessKind, string>;
  help: Record<AccessKind, string>;
}) {
  const t = useT();
  const [state, setState] = useState(values);
  const { run } = useAction();
  const kinds: AccessKind[] = ["browser", "whatsapp", "shell", "repos"];
  return (
    <div className="divide-y divide-border">
      {kinds.map((k) => (
        <SwitchRow
          key={k}
          label={labels[k]}
          help={help[k]}
          checked={state[k]}
          onCheckedChange={(on) => {
            setState((s) => ({ ...s, [k]: on }));
            run(() => toggle(k, on), on ? t("team.toast.accessOn", { what: labels[k] }) : t("team.toast.accessOff", { what: labels[k] }));
          }}
        />
      ))}
    </div>
  );
}

/** "Run now": queue the teammate's scheduled work. */
export function RunNowButton({ businessId, teammateId }: { businessId: string; teammateId: string }) {
  const t = useT();
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set("businessId", businessId);
        fd.set("teammateId", teammateId);
        run(() => runScheduledNow(fd), t("team.toast.queued"));
      }}
    >
      <Play />
      {t("team.runNow")}
    </Button>
  );
}

/** "This is me" / "Not me" for a person row. */
export function OwnerButton({ set, isOwner }: { set: () => Promise<void>; isOwner: boolean }) {
  const t = useT();
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant={isOwner ? "ghost" : "secondary"}
      loading={pending}
      onClick={() => run(set, isOwner ? t("team.toast.notOwner") : t("team.toast.owner"))}
    >
      {isOwner ? t("team.stop") : t("team.thisIsMeShort")}
    </Button>
  );
}
