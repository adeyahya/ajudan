"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@/components/kit";
import { LangField, useT } from "@/components/i18n";
import { appBridge } from "@/lib/app-bridge";
import { createBusiness, openFolderByPath, type FolderFormState } from "./actions";
import { LanguageSelect } from "./language-select";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t("common.working") : children}
    </Button>
  );
}

/** Desktop app: a folder the server just created or found opens in its own window. */
function useOpenInWindow(state: FolderFormState) {
  useEffect(() => {
    if (state.openDir) void appBridge()?.openFolder(state.openDir);
  }, [state]);
}

/** Desktop app: open (or bring forward) the business's window. */
export function AppOpenButton({ dir, label }: { dir: string; label: string }) {
  const [opening, setOpening] = useState(false);
  const t = useT();
  return (
    <Button
      type="button"
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
      {opening ? t("home.form.opening") : label}
    </Button>
  );
}

const ErrorLine = ({ state }: { state: FolderFormState }) =>
  state.error ? <p className="text-sm text-bad">{state.error}</p> : null;

/** New business = new folder (defaults to ~/Ajudan/<name>). */
export function NewBusinessForm({ home, defaultLanguage }: { home: string; defaultLanguage: string }) {
  const t = useT();
  const [state, action] = useActionState(createBusiness, {});
  useOpenInWindow(state);
  const [name, setName] = useState("");
  const shown = home.replace(/^\/Users\/[^/]+/, "~");
  return (
    <form action={action} className="grid gap-3">
      <LangField />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="name">{t("home.form.name")}</Label>
          <Input id="name" name="name" required placeholder={t("home.form.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="website">{t("home.form.website")}</Label>
          <Input id="website" name="website" placeholder="https://acme.coffee" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="language">{t("home.form.language")}</Label>
          <LanguageSelect id="language" defaultValue={defaultLanguage} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="folder">{t("home.form.folder")}</Label>
        <Input id="folder" name="folder" placeholder={`${shown}/${name.trim() || t("home.form.name")}`} className="font-mono text-xs" />
      </div>
      <ErrorLine state={state} />
      <div>
        <Submit>{t("home.form.create")}</Submit>
      </div>
    </form>
  );
}

/** Open a business folder that isn't in the list (moved, copied, restored). */
export function OpenFolderForm() {
  const t = useT();
  const [state, action] = useActionState(openFolderByPath, {});
  useOpenInWindow(state);
  return (
    <form action={action} className="grid gap-2">
      <LangField />
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-64 flex-1 gap-1">
          <Label htmlFor="path">{t("home.form.path")}</Label>
          <Input id="path" name="path" required placeholder="~/Ajudan/Orucraft" className="font-mono text-xs" />
        </div>
        <Submit>{t("home.form.open")}</Submit>
      </div>
      <ErrorLine state={state} />
    </form>
  );
}
