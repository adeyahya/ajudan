"use client";

import { FileText, Network, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { useT } from "@/components/i18n";
import { Button, cn } from "@/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ContextSection } from "@/db/schema";
import { createPageAction, createFromTemplateAction, type PageTemplate } from "./actions";

export const TEMPLATES: PageTemplate[] = ["faq", "prices", "voice", "sop"];

/** Make a page, a mind map or a page from a template, then open it. */
export function useNewPage(businessId: string) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const base = `/b/${businessId}/context`;
  return {
    pending,
    page: (section: ContextSection, kind: "page" | "mindmap" = "page") =>
      start(async () => router.push(`${base}?page=${await createPageAction(businessId, section, t("context.untitled"), null, kind)}`)),
    template: (tpl: PageTemplate) => start(async () => router.push(`${base}?page=${await createFromTemplateAction(businessId, tpl)}`)),
  };
}

/** The "+ New" menu: a page, a mind map, or a template (Context home and the page tree). */
export function NewMenu({ businessId, section = "business", trigger, align = "end" }: { businessId: string; section?: ContextSection; trigger?: ReactNode; align?: "start" | "end" }) {
  const t = useT();
  const make = useNewPage(businessId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button size="sm" loading={make.pending}>
            <Plus />
            {t("context.new")}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuItem onSelect={() => make.page(section)}>
          <FileText />
          {t("context.newPage")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => make.page(section, "mindmap")}>
          <Network />
          {t("context.newMindMap")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("context.tpl.label")}</DropdownMenuLabel>
        {TEMPLATES.map((tpl) => (
          <DropdownMenuItem key={tpl} onSelect={() => make.template(tpl)}>
            <span className="size-4" aria-hidden />
            {t(`context.tpl.${tpl}.title`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The home's dashed "start from a template" tile. */
export function TemplateTile({ businessId, className }: { businessId: string; className?: string }) {
  const t = useT();
  const make = useNewPage(businessId);
  return (
    <div className={cn("flex flex-col justify-center gap-2 rounded-lg border border-dashed border-border-strong p-4", className)}>
      <p className="text-sm leading-5 font-medium text-foreground">{t("context.tpl.tileTitle")}</p>
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATES.map((tpl) => (
          <Button key={tpl} size="sm" variant="secondary" disabled={make.pending} onClick={() => make.template(tpl)}>
            {t(`context.tpl.${tpl}.title`)}
          </Button>
        ))}
        <Button size="sm" variant="secondary" disabled={make.pending} onClick={() => make.page("business", "mindmap")}>
          <Network />
          {t("context.mindmap.label")}
        </Button>
      </div>
    </div>
  );
}
