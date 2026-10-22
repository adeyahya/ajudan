"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Badge, Card, cn } from "@/components/kit";
import type { Edit } from "@/db/schema";
import { deleteEdit } from "../actions";

const TONE = { draft: "neutral", queued: "blue", rendering: "amber", done: "green", failed: "red" } as const;
const LABEL = { draft: "Draft", queued: "Queued", rendering: "Rendering…", done: "Ready", failed: "Failed" } as const;

export const fileUrl = (businessId: string, rel: string) => `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

export function StatusBadge({ status }: { status: Edit["status"] }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}

/** Saved edits of one kind: open, see their render status, delete. */
export function EditsList({ businessId, edits, kind, currentId }: { businessId: string; edits: Edit[]; kind: Edit["kind"]; currentId?: string }) {
  const [pending, start] = useTransition();
  const base = `/b/${businessId}/studio/${kind}`;
  return (
    <Card className="space-y-1 p-2 text-sm">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="font-pixel">Your {kind} edits</span>
        <Link href={base} className="text-xs text-primary hover:underline">
          + New
        </Link>
      </div>
      {edits.length === 0 && <p className="px-1 pb-1 text-xs text-muted-foreground">Saved edits show up here.</p>}
      {edits.map((e) => (
        <div key={e.id} className={cn("group flex items-center gap-2 px-1 py-1 hover:bg-muted", e.id === currentId && "bg-muted")}>
          <Link href={`${base}?edit=${e.id}`} className="min-w-0 flex-1 truncate" title={e.title}>
            {e.title}
          </Link>
          <StatusBadge status={e.status} />
          <button
            type="button"
            disabled={pending}
            onClick={() => confirm(`Delete the edit "${e.title}"? Rendered files stay in the library.`) && start(() => deleteEdit(businessId, e.id))}
            className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500"
            aria-label={`Delete ${e.title}`}
          >
            ✕
          </button>
        </div>
      ))}
    </Card>
  );
}

/** Where the current edit stands, and its last render. */
export function RenderResult({ businessId, edit }: { businessId: string; edit?: Edit }) {
  if (!edit) return null;
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <StatusBadge status={edit.status} />
        {edit.status === "queued" && <span className="text-xs text-muted-foreground">Waiting for the worker…</span>}
        {edit.status === "rendering" && <span className="text-xs text-muted-foreground">ffmpeg is working on it on this Mac.</span>}
      </div>
      {edit.status === "failed" && edit.error && <p className="text-xs break-words text-red-600 dark:text-red-400">{edit.error}</p>}
      {edit.output && (
        <p className="text-xs">
          Last render:{" "}
          <a href={fileUrl(businessId, edit.output)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {edit.output.replace(/^media\//, "")}
          </a>{" "}
          · <Link href={`/b/${businessId}/studio`} className="text-primary hover:underline">in the library</Link>
        </p>
      )}
    </div>
  );
}
