"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Button, Field, Input, Section } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROVIDER_DEFAULTS, PROVIDERS, type BackendSettings, type Provider } from "@/lib/backend";
import { ActionForm, SubmitButton } from "../team/action-form";
import { saveBackendAction, testBackendAction } from "./actions";

/**
 * Business → AI backend: which provider runs the team (src/lib/backend.ts). Claude Code
 * uses the local login; OpenRouter needs a key (kept in the Keychain, never shown again);
 * Ollama runs on this computer. Blank fields take the provider's defaults.
 */
export function BackendPanel({ businessId, stored, hasKey }: { businessId: string; stored: BackendSettings | null; hasKey: boolean }) {
  const t = useT();
  const [provider, setProvider] = useState<Provider>(stored?.provider ?? "claude");
  const [testing, startTest] = useTransition();
  const d = PROVIDER_DEFAULTS[provider];
  // Fields keep what's saved only for the provider it was saved for.
  const saved = stored?.provider === provider ? stored : undefined;
  return (
    <Section title={t("profile.backend.title")} description={t("profile.backend.help")}>
      <ActionForm action={saveBackendAction.bind(null, businessId)} success={t("profile.backend.saved")} className="grid max-w-xl gap-4">
        <Field label={t("profile.backend.provider")} htmlFor="provider" hint={t(`profile.backend.${provider}.help`)}>
          {/* Uncontrolled: the form resets after saving, back to this (saved) value. */}
          <Select name="provider" defaultValue={stored?.provider ?? "claude"} onValueChange={(v) => setProvider(v as Provider)}>
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
          <>
            <Field label={t("profile.backend.baseUrl")} htmlFor="baseUrl">
              <Input key={`url-${provider}`} id="baseUrl" name="baseUrl" defaultValue={saved?.baseUrl ?? ""} placeholder={d.baseUrl} className="font-mono text-[13px]" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("profile.backend.mainModel")} htmlFor="mainModel" hint={t("profile.backend.mainModelHelp")}>
                <Input key={`main-${provider}`} id="mainModel" name="mainModel" defaultValue={saved?.mainModel ?? ""} placeholder={d.mainModel} className="font-mono text-[13px]" />
              </Field>
              <Field label={t("profile.backend.fastModel")} htmlFor="fastModel" hint={t("profile.backend.fastModelHelp")}>
                <Input key={`fast-${provider}`} id="fastModel" name="fastModel" defaultValue={saved?.fastModel ?? ""} placeholder={d.fastModel} className="font-mono text-[13px]" />
              </Field>
            </div>
            {d.needsKey && (
              <Field label={t("profile.backend.apiKey")} htmlFor="apiKey" hint={t(hasKey ? "profile.backend.keyStored" : "profile.backend.keyHelp")}>
                <Input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={hasKey ? "••••••••" : "sk-or-…"} className="font-mono text-[13px]" />
              </Field>
            )}
            <p className="text-[13px] leading-[18px] text-muted-foreground">{t("profile.backend.limits")}</p>
          </>
        )}
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
