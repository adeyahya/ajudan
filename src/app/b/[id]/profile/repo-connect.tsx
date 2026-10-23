"use client";

import { FolderOpen } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Button, Input } from "@/components/kit";
import { appBridge } from "@/lib/app-bridge";
import type { RepoError } from "@/lib/repos";
import { connectRepository } from "./actions";

const ERRORS: Record<RepoError, "profile.repos.err.missing" | "profile.repos.err.notGit" | "profile.repos.err.businessFolder"> = {
  missing: "profile.repos.err.missing",
  not_git: "profile.repos.err.notGit",
  business_folder: "profile.repos.err.businessFolder",
};

/** Connect a repository: pick its folder in the app's dialog, or paste the path in a browser. */
export function RepoConnect({ businessId }: { businessId: string }) {
  const t = useT();
  const [dir, setDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const picker = appBridge()?.pickFolder;

  const connect = (path: string) =>
    start(async () => {
      setError(null);
      const r = await connectRepository(businessId, path);
      if ("error" in r) setError(t(ERRORS[r.error]));
      else {
        setDir("");
        toast.success(t("profile.repos.connected", { name: r.name }));
      }
    });

  return (
    <div className="grid gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dir.trim()) connect(dir);
        }}
      >
        {picker && (
          <Button
            type="button"
            size="sm"
            loading={pending}
            disabled={pending}
            onClick={async () => {
              const picked = await picker();
              if (picked) connect(picked);
            }}
          >
            <FolderOpen /> {t("profile.repos.choose")}
          </Button>
        )}
        <Input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          aria-label={t("profile.repos.path")}
          placeholder="~/dev/my-app"
          className="h-8 min-w-56 flex-1 font-mono text-[13px]"
        />
        <Button type="submit" size="sm" variant={picker ? "secondary" : "primary"} disabled={pending || !dir.trim()} loading={pending && !picker}>
          {t("profile.repos.connect")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
