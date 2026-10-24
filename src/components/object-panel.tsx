"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadObjectPanel, type ObjectPanelData } from "@/app/b/[id]/actions";
import type { ObjectRef } from "@/lib/links";

/**
 * The shared panel under any doc, deliverable, asset or contact: what it links to, what
 * links to it, and its history. Areas mount it in their side peek with the object's ref.
 * Contract for other areas: `<ObjectPanel businessId objectRef />`, nothing else.
 */
export function ObjectPanel({ businessId, objectRef }: { businessId: string; objectRef: ObjectRef }) {
  const [data, setData] = useState<ObjectPanelData | null>(null);
  const key = `${objectRef.type}:${objectRef.id}`;

  useEffect(() => {
    let live = true;
    loadObjectPanel(businessId, objectRef).then((d) => live && setData(d));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, key]);

  if (!data || data.links.length === 0) return null;
  return (
    <ul className="space-y-1 text-[13px]">
      {data.links.map((l) => (
        <li key={`${l.direction}:${l.type}:${l.id}`}>
          <Link href={l.href} className="text-muted-foreground hover:text-foreground">
            {l.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
