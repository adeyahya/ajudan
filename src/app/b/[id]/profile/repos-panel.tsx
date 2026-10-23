import { FolderGit2, Trash2 } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Badge, Button, EmptyState, Section } from "@/components/kit";
import { t, type UiLang } from "@/lib/i18n";
import { ghStatus, listRepos } from "@/lib/repos";
import { ActionForm, SubmitButton } from "../team/action-form";
import { disconnectRepository } from "./actions";
import { RepoConnect } from "./repo-connect";

/**
 * Code repositories: local git folders the technical teammates read (never change), and
 * whose GitHub issues they use through the owner's own gh login.
 */
export async function ReposPanel({ businessId, teammatesWithAccess, lang }: { businessId: string; teammatesWithAccess: string[]; lang: UiLang }) {
  await connection();
  const repos = listRepos(businessId);
  const gh = await ghStatus();

  return (
    <div>
      <Section
        title={t(lang, "profile.repos.title")}
        description={t(lang, "profile.repos.help")}
        actions={
          <Badge tone={gh.ok ? "green" : "yellow"} title={gh.ok ? undefined : t(lang, gh.reason === "missing" ? "profile.repos.ghMissing" : "profile.repos.ghSignedOut")}>
            {gh.ok ? t(lang, "profile.repos.ghAs", { account: gh.account }) : t(lang, "profile.repos.ghOff")}
          </Badge>
        }
      >
        <RepoConnect businessId={businessId} />
        {!gh.ok && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t(lang, gh.reason === "missing" ? "profile.repos.ghMissing" : "profile.repos.ghSignedOut")}{" "}
            <code className="rounded-sm bg-muted px-1 font-mono">{gh.reason === "missing" ? "brew install gh" : "gh auth login"}</code>
          </p>
        )}

        <div className="mt-6">
          {repos.length === 0 ? (
            <EmptyState compact icon={<FolderGit2 />} title={t(lang, "profile.repos.emptyTitle")} body={t(lang, "profile.repos.emptyBody")} />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {repos.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <FolderGit2 className="size-4 shrink-0 text-tertiary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium">{r.name}</span>
                      {r.githubRepo ? (
                        <a
                          href={`https://github.com/${r.githubRepo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground underline decoration-border-strong underline-offset-2 hover:text-foreground"
                        >
                          {r.githubRepo}
                        </a>
                      ) : (
                        <Badge tone="yellow">{t(lang, "profile.repos.noGithub")}</Badge>
                      )}
                    </div>
                    <div className="truncate font-mono text-xs text-tertiary" title={r.path}>
                      {r.path}
                    </div>
                  </div>
                  <ActionForm action={disconnectRepository.bind(null, businessId, r.id)} success={t(lang, "profile.repos.disconnected", { name: r.name })}>
                    <SubmitButton size="sm" variant="ghost" aria-label={t(lang, "profile.repos.disconnect", { name: r.name })} title={t(lang, "profile.repos.disconnect", { name: r.name })}>
                      <Trash2 />
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title={t(lang, "profile.repos.teamTitle")}>
        <p className="text-sm text-muted-foreground">
          {teammatesWithAccess.length ? t(lang, "profile.repos.canUse", { names: teammatesWithAccess.join(", ") }) : t(lang, "profile.repos.nobody")}
        </p>
        <p className="mt-2 text-xs text-tertiary">{t(lang, "profile.repos.teamHelp")}</p>
        <Button asChild size="sm" variant="secondary" className="mt-3">
          <Link href={`/b/${businessId}/team`}>{t(lang, "profile.repos.openTeam")}</Link>
        </Button>
      </Section>
    </div>
  );
}
