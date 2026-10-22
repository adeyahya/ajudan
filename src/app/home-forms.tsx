"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@/components/kit";
import { appBridge } from "@/lib/app-bridge";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { createBusiness, openFolderByPath, type FolderFormState } from "./actions";
import { LanguageSelect } from "./language-select";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Working…" : children}
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
      {opening ? "Opening…" : label}
    </Button>
  );
}

const ErrorLine = ({ state }: { state: FolderFormState }) =>
  state.error ? <p className="text-sm text-bad">{state.error}</p> : null;

/** New business = new folder (defaults to ~/Ajudan/<name>). */
export function NewBusinessForm({ home }: { home: string }) {
  const [state, action] = useActionState(createBusiness, {});
  useOpenInWindow(state);
  const [name, setName] = useState("");
  const shown = home.replace(/^\/Users\/[^/]+/, "~");
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="name">Business name</Label>
          <Input id="name" name="name" required placeholder="Acme Coffee" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" placeholder="https://acme.coffee" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="language">Language</Label>
          <LanguageSelect id="language" defaultValue={DEFAULT_LANGUAGE} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="folder">Folder (everything for this business is stored here)</Label>
        <Input id="folder" name="folder" placeholder={`${shown}/${name.trim() || "Business name"}`} className="font-mono text-xs" />
      </div>
      <ErrorLine state={state} />
      <div>
        <Submit>Create folder &amp; start interview</Submit>
      </div>
    </form>
  );
}

/** Open a business folder that isn't in the list (moved, copied, restored). */
export function OpenFolderForm() {
  const [state, action] = useActionState(openFolderByPath, {});
  useOpenInWindow(state);
  return (
    <form action={action} className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-64 flex-1 gap-1">
          <Label htmlFor="path">Folder path</Label>
          <Input id="path" name="path" required placeholder="~/Ajudan/Orucraft" className="font-mono text-xs" />
        </div>
        <Submit>Open</Submit>
      </div>
      <ErrorLine state={state} />
    </form>
  );
}
