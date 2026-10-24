import { BookOpen, FileText, Image as ImageIcon, ListTodo, UserRound } from "lucide-react";
import type { ObjectType } from "@/db/schema";
import { cn } from "@/lib/utils";

const ICONS = { doc: BookOpen, deliverable: FileText, asset: ImageIcon, contact: UserRound, task: ListTodo } satisfies Record<ObjectType, unknown>;

/** The icon for a workspace object type (Context page, doc, library file, contact, task). Server- and client-safe. */
export function ObjectTypeIcon({ type, className }: { type: ObjectType; className?: string }) {
  const Icon = ICONS[type] ?? FileText;
  return <Icon aria-hidden className={cn("size-4 shrink-0 stroke-[1.75] text-tertiary", className)} />;
}
