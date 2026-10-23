"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Button, Field, Input, Section } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CLAUDE_MODELS, PROVIDER_DEFAULTS, PROVIDERS, type BackendSettings, type ModelOption, type OpenRouterRoute, type Provider } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../team/action-form";
import { listModelsAction, saveBackendAction, testBackendAction } from "./actions";
import { ModelPicker } from "./model-picker";

const ROUTES: OpenRouterRoute[] = ["pick", "free", "auto"];

/**
 * Business → AI backend: which provider runs the team (src/lib/backend.ts) and which
 * models. Claude runs on Claude Code with the local login; OpenRouter (key kept in the
 * Keychain, never shown again) and Ollama run on the AI SDK engine. OpenRouter can pick
 * models, send everything to its free router, or let its auto router choose, with free
 * models as a fallback. Blank fields take the provider's defaults.
 */
export function BackendPanel({ businessId, stored, hasKey }: { businessId: string; stored: BackendSettings | null; hasKey: boolean }) {
  const t = useT();
  const [provider, setProvider] = useState<Provider>(stored?.provider ?? "claude");
  const [route, setRoute] = useState<OpenRouterRoute>(stored?.route ?? "pick");
  const [testing, startTest] = useTransition();
  const d = PROVIDER_DEFAULTS[provider];
  // Fields keep what's saved only for the provider it was saved for.
  const saved = stored?.provider === provider ? stored : undefined;
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  // One catalog request per provider and address, shared by both pickers.
  const catalogs = useRef(new Map<string, Promise<{ models: ModelOption[]; error?: string }>>());
  const load = () => {
    const k = `${provider} ${baseUrl}`;
    if (!catalogs.current.has(k)) catalogs.current.set(k, listModelsAction(businessId, provider, baseUrl || undefined));
    return catalogs.current.get(k)!;
  };
  const claudeName = (id: string) => CLAUDE_MODELS.find((m) => m.id === id)?.name ?? id;
  const pickers = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("profile.backend.mainModel")} htmlFor="mainModel" hint={t("profile.backend.mainModelHelp")}>
        <ModelPicker
          key={`main-${provider}`}
          id="mainModel"
          name="mainModel"
          defaultValue={saved?.mainModel ?? ""}
          load={load}
          prices={provider === "openrouter"}
          placeholder={d.mainModel}
          defaultLabel={provider === "claude" ? t("profile.backend.claudeDefault", { model: claudeName("claude-opus-5-5") }) : undefined}
        />
      </Field>
      <Field label={t("profile.backend.fastModel")} htmlFor="fastModel" hint={t("profile.backend.fastModelHelp")}>
        <ModelPicker
          key={`fast-${provider}`}
          id="fastModel"
          name="fastModel"
          defaultValue={saved?.fastModel ?? ""}
          load={load}
          prices={provider === "openrouter"}
          placeholder={provider === "claude" ? "" : t("profile.backend.sameAsMain")}
          defaultLabel={provider === "claude" ? t("profile.backend.claudeDefault", { model: claudeName("claude-haiku-5-5") }) : t("profile.backend.sameAsMain")}
        />
      </Field>
    </div>
  );

  return (
    <Section title={t("profile.backend.title")} description={t("profile.backend.help")}>
      <ActionForm action={saveBackendAction.bind(null, businessId)} success={t("profile.backend.saved")} className="grid max-w-2xl gap-4">
        <Field label={t("profile.backend.provider")} htmlFor="provider" hint={t(`profile.backend.${provider}.help`)}>
          {/* Uncontrolled: the form resets after saving, back to this (saved) value. */}
          <Select name="provider" defaultValue={stored?.provider ?? "claude"} onValueChange={(v) => {
              setProvider(v as Provider);
              setBaseUrl(stored?.provider === v ? (stored.baseUrl ?? "") : "");
            }}>
            <SelectTrigger id="provider" size="sm" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`profile.backend.${p}.label`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {provider !== "claude" && (
          <Field label={t("profile.backend.baseUrl")} htmlFor="baseUrl">
            <Input key={`url-${provider}`} id="baseUrl" name="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={d.baseUrl} className="font-mono text-[13px]" />
          </Field>
        )}

        {provider === "openrouter" && (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-[13px] leading-[18px] font-medium text-foreground">{t("profile.backend.route")}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {ROUTES.map((r) => (
                <label
                  key={r}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-colors",
                    route === r ? "border-primary bg-primary-soft" : "border-border hover:bg-hover/50",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <input type="radio" name="route" value={r} checked={route === r} onChange={() => setRoute(r)} className="accent-primary" />
                    {t(`profile.backend.route.${r}`)}
                  </span>
                  <span className="text-xs leading-[16px] text-muted-foreground">{t(`profile.backend.route.${r}.help`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {(provider !== "openrouter" || route === "pick") && pickers}

        {provider === "openrouter" && route !== "free" && (
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-[18px]">
            <Checkbox name="fallbackToFree" defaultChecked={saved?.fallbackToFree ?? false} className="mt-0.5" />
            <span>
              <span className="block font-medium text-foreground">{t("profile.backend.fallback")}</span>
              <span className="block text-muted-foreground">{t("profile.backend.fallbackHelp")}</span>
            </span>
          </label>
        )}

        {provider === "openrouter" && route === "free" && <p className="text-[13px] leading-[18px] text-muted-foreground">{t("profile.backend.freeNote")}</p>}

        {d.needsKey && (
          <Field label={t("profile.backend.apiKey")} htmlFor="apiKey" hint={t(hasKey ? "profile.backend.keyStored" : "profile.backend.keyHelp")}>
            <Input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={hasKey ? "••••••••" : "sk-or-…"} className="font-mono text-[13px]" />
          </Field>
        )}
        {provider !== "claude" && <p className="text-[13px] leading-[18px] text-muted-foreground">{t("profile.backend.limits")}</p>}

        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="secondary">
            {t("common.save")}
          </SubmitButton>
          {stored && stored.provider !== "claude" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={testing}
              onClick={() =>
                startTest(async () => {
                  const r = await testBackendAction(businessId);
                  (r.ok ? toast.success : toast.error)(r.message);
                })
              }
            >
              {t("profile.backend.test")}
            </Button>
          )}
        </div>
      </ActionForm>
    </Section>
  );
}
