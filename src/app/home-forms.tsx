"use client";

import { Ellipsis, FolderOpen, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useId, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Field, IconButton, Input } from "@/components/kit";
import { LangField, useT } from "@/components/i18n";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { appBridge } from "@/lib/app-bridge";
import { createBusiness, forgetFolderAction, openFolderByPath, type FolderFormState } from "./actions";
import { LanguageSelect } from "./language-select";

function Submit({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/** Desktop app: a folder the server just created or found opens in its own window. */
function useOpenInWindow(state: FolderFormState, onOpened?: () => void) {
  useEffect(() => {
    if (state.openDir) {
      void appBridge()?.openFolder(state.openDir);
      onOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per action result
  }, [state]);
}

/** Desktop app: open (or bring forward) the business's window. */
export function AppOpenButton({ dir, label }: { dir: string; label: string }) {
  const [opening, setOpening] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      loading={opening}
      disabled={opening}
      onClick={async () => {
        setOpening(true);
        try {
          await appBridge()?.openFolder(dir);
        } finally {
          setTimeout(() => setOpening(false), 1500);
        }
      }}
    >
      {label}
    </Button>
  );
}

/** Stop a business running in the background (desktop app); the list then shows it stopped. */
export function AppStopButton({ dir, name, label, title }: { dir: string; name: string; label: string; title: string }) {
  const t = useT();
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      title={title}
      loading={stopping}
      disabled={stopping}
      onClick={async () => {
        setStopping(true);
        try {
          if (await appBridge()?.stopFolder?.(dir)) toast(t("home.stopped", { name }));
        } finally {
          setStopping(false);
          router.refresh();
        }
      }}
    >
      {label}
    </Button>
  );
}

const ErrorLine = ({ state }: { state: FolderFormState }) =>
  state.error ? (
    <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-[13px] leading-[18px] text-destructive">
      {state.error}
    </p>
  ) : null;

/** New business = new folder (defaults to ~/Ajudan/<name>). */
function NewBusinessForm({ home, defaultLanguage, onOpened }: { home: string; defaultLanguage: string; onOpened?: () => void }) {
  const t = useT();
  const ids = useId();
  const [state, action] = useActionState(createBusiness, {});
  useOpenInWindow(state, onOpened);
  const [name, setName] = useState("");
  const shown = home.replace(/^\/Users\/[^/]+/, "~");
  return (
    <form action={action} className="grid gap-5">
      <LangField />
      <Field label={t("home.form.name")} htmlFor={`${ids}-name`}>
        <Input id={`${ids}-name`} name="name" required autoFocus placeholder={t("home.form.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("home.form.website")} hint={t("home.form.websiteHint")} htmlFor={`${ids}-website`}>
          <Input id={`${ids}-website`} name="website" placeholder="https://acme.coffee" />
        </Field>
        <Field label={t("home.form.language")} htmlFor={`${ids}-language`}>
          <LanguageSelect id={`${ids}-language`} defaultValue={defaultLanguage} />
        </Field>
      </div>
      <Field label={t("home.form.folderShort")} hint={t("home.form.folderHint")} htmlFor={`${ids}-folder`}>
        <Input id={`${ids}-folder`} name="folder" placeholder={`${shown}/${name.trim() || t("home.form.name")}`} className="font-mono text-[13px]" />
      </Field>
      <ErrorLine state={state} />
      <DialogFooter>
        <Submit>{t("home.form.create")}</Submit>
      </DialogFooter>
    </form>
  );
}

/** Open a business folder that isn't in the list (moved, copied, restored). */
function OpenFolderForm({ onOpened }: { onOpened?: () => void }) {
  const t = useT();
  const ids = useId();
  const [state, action] = useActionState(openFolderByPath, {});
  useOpenInWindow(state, onOpened);
  return (
    <form action={action} className="grid gap-5">
      <LangField />
      <Field label={t("home.form.path")} htmlFor={`${ids}-path`}>
        <Input id={`${ids}-path`} name="path" required autoFocus placeholder="~/Ajudan/Orucraft" className="font-mono text-[13px]" />
      </Field>
      <ErrorLine state={state} />
      <DialogFooter>
        <Submit>{t("home.form.open")}</Submit>
      </DialogFooter>
    </form>
  );
}

/** "New business" → dialog. */
export function NewBusinessDialog({ home, defaultLanguage, trigger }: { home: string; defaultLanguage: string; trigger?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus />
            {t("home.new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("home.newTitle")}</DialogTitle>
          <DialogDescription>{t("home.newBody")}</DialogDescription>
        </DialogHeader>
        {open && <NewBusinessForm home={home} defaultLanguage={defaultLanguage} onOpened={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** "Open a folder…" → dialog. */
export function OpenFolderDialog({ variant = "ghost" }: { variant?: "ghost" | "secondary" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          <FolderOpen />
          {t("home.openFolder")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("home.openTitle")}</DialogTitle>
          <DialogDescription>{t("home.openBody")}</DialogDescription>
        </DialogHeader>
        {open && <OpenFolderForm onOpened={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

const noop = () => () => {};

/** Puts its children in the root layout's top bar (#site-header-actions). */
export function SiteHeaderActions({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const el = mounted ? document.getElementById("site-header-actions") : null;
  return el ? createPortal(children, el) : null;
}

/** "…" on a business row → Remove from list (behind a confirm). The folder stays on disk. */
export function FolderMenu({ dir, name }: { dir: string; name: string }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton label={t("home.more")}>
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
            <Trash2 />
            {t("home.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.removeConfirm", { name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("home.removeTitle")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                start(async () => {
                  try {
                    await forgetFolderAction(dir);
                  } catch (err) {
                    const digest = (err as { digest?: string } | null)?.digest;
                    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
                      toast.success(t("home.removed", { name }));
                      throw err;
                    }
                    toast.error(err instanceof Error ? err.message : String(err));
                  }
                })
              }
            >
              {t("home.removeShort")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
