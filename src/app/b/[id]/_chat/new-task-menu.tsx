"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useT } from "@/components/i18n";
import { Avatar, IconButton } from "@/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type TaskTarget = { id: string; name: string; color: string; title: string; href: string };

/**
 * The "+" in the conversation list header: pick who gets a new task, then land in their
 * conversation with the composer focused (`?compose=1`, handled by the Chat composer).
 */
export function NewTaskMenu({ targets }: { targets: TaskTarget[] }) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("chathome.giveTask")} side="bottom">
          <Plus />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-tertiary">{t("chathome.giveTaskTo")}</DropdownMenuLabel>
        {targets.map((m) => (
          <DropdownMenuItem key={m.id} asChild>
            <Link href={m.href}>
              <Avatar seed={m.id} name={m.name} color={m.color} size={20} />
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="max-w-[45%] truncate text-xs text-tertiary">{m.title}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
