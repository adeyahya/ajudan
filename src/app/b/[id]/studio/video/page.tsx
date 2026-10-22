import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LiveRefresh } from "@/components/live";
import { PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { editorSources, listEdits } from "@/lib/studio-data";
import { VideoEditor } from "./video-editor";

export default function VideoEditorPage(props: PageProps<"/b/[id]/studio/video">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: PageProps<"/b/[id]/studio/video">) {
  const { id } = await params;
  const sp = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const [sources, edits] = await Promise.all([editorSources(id), listEdits(id, "video")]);
  const add = ([] as string[]).concat(sp.add ?? []);
  const editId = typeof sp.edit === "string" ? sp.edit : undefined;
  return (
    <>
      <LiveRefresh businessId={id} types={["edit_rendering", "edit_rendered", "edit_failed"]} />
      <VideoEditor key={editId ?? add.join(",")} businessId={id} sources={sources} edits={edits} initialEditId={editId} initialAdd={add} />
    </>
  );
}
