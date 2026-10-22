import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LiveRefresh } from "@/components/live";
import { StudioSkeleton } from "../_components/studio-skeleton";
import { StudioShell } from "../_components/studio-shell";
import { getBusiness } from "@/lib/data";
import { editorSources, listEdits } from "@/lib/studio-data";
import { AudioEditor } from "./audio-editor";

export default function AudioEditorPage(props: PageProps<"/b/[id]/studio/audio">) {
  return (
    <Suspense fallback={<StudioSkeleton shape="editor" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: PageProps<"/b/[id]/studio/audio">) {
  const { id } = await params;
  const sp = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const [sources, edits] = await Promise.all([editorSources(id), listEdits(id, "audio")]);
  const editId = typeof sp.edit === "string" ? sp.edit : undefined;
  const file = typeof sp.file === "string" ? sp.file : undefined;
  return (
    <StudioShell>
      <LiveRefresh businessId={id} types={["edit_rendering", "edit_rendered", "edit_failed"]} />
      <AudioEditor key={editId ?? file ?? "new"} businessId={id} sources={sources} edits={edits} initialEditId={editId} initialFile={file} />
    </StudioShell>
  );
}
