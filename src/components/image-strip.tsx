"use client";

import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FileIcon, MusicIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/components/i18n";
import { Button } from "@/components/ui/button";
import { mediaKind } from "@/lib/media-types";
import { cn } from "@/lib/utils";

/** URL for a file in the open business folder, e.g. "work/images/slide-1.png". */
export const fileUrl = (businessId: string, rel: string) =>
  `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

const fileName = (rel: string) => rel.split("/").pop() ?? rel;

/** Small preview of one file: image, first video frame, or an icon. */
function Thumb({ businessId, file, label }: { businessId: string; file: string; label?: string }) {
  const kind = mediaKind(file);
  const url = fileUrl(businessId, file);
  return (
    <>
      {kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
        <img src={url} alt={fileName(file)} className="size-full object-cover" loading="lazy" />
      )}
      {kind === "video" && (
        <>
          <video src={`${url}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-8 items-center justify-center bg-ink/70 text-parchment">
              <PlayIcon className="size-4" />
            </span>
          </span>
        </>
      )}
      {(kind === "audio" || kind === "file") && (
        <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-muted-foreground">
          {kind === "audio" ? <MusicIcon className="size-6" /> : <FileIcon className="size-6" />}
          <span className="line-clamp-2 break-all text-center text-[10px]">{fileName(file)}</span>
        </span>
      )}
      {label && <span className="font-pixel absolute bottom-0 left-0 bg-ink/80 px-1 text-[10px] text-parchment">{label}</span>}
    </>
  );
}

/**
 * Thumbnails of a piece of work's files (carousel slides, videos, footage). Click one
 * to view it large (videos play), flip through with ← →, or download it.
 */
export function ImageStrip({
  businessId,
  images,
  size = 96,
  className,
}: {
  businessId: string;
  /** Folder-relative paths ("work/images/…", "work/videos/…", "media/…"). */
  images: string[];
  size?: number;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % images.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, images.length]);

  if (!images.length) return null;
  const current = open === null ? null : images[open];
  return (
    <>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {images.map((img, i) => (
          <button
            key={img}
            type="button"
            onClick={() => setOpen(i)}
            className="pixel-frame relative m-[3px] overflow-hidden bg-muted transition hover:-translate-y-0.5"
            style={{ width: size, height: Math.round(size * 1.25) }}
            title={fileName(img)}
          >
            <Thumb businessId={businessId} file={img} label={String(i + 1)} />
          </button>
        ))}
      </div>

      {open !== null && current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-label={t("ui.mediaViewer")}
        >
          <div className="relative flex max-h-full max-w-full flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <Viewer businessId={businessId} file={current} />
            <div className="flex items-center gap-2">
              {images.length > 1 && (
                <Button variant="outline" size="icon" onClick={() => setOpen((open - 1 + images.length) % images.length)} aria-label={t("ui.previous")}>
                  <ChevronLeftIcon />
                </Button>
              )}
              <span className="font-pixel text-sm text-parchment">
                {open + 1} / {images.length}
              </span>
              {images.length > 1 && (
                <Button variant="outline" size="icon" onClick={() => setOpen((open + 1) % images.length)} aria-label={t("ui.next")}>
                  <ChevronRightIcon />
                </Button>
              )}
              <Button asChild variant="outline" size="icon" aria-label={t("ui.download")}>
                <a href={fileUrl(businessId, current)} download={fileName(current)}>
                  <DownloadIcon />
                </a>
              </Button>
              <Button variant="outline" size="icon" onClick={() => setOpen(null)} aria-label={t("ui.close")}>
                <XIcon />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Viewer({ businessId, file }: { businessId: string; file: string }) {
  const url = fileUrl(businessId, file);
  const kind = mediaKind(file);
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
    return <img src={url} alt={fileName(file)} className="pixel-frame max-h-[80dvh] max-w-[90vw] object-contain" />;
  }
  if (kind === "video") {
    return <video key={url} src={url} controls autoPlay playsInline className="pixel-frame max-h-[80dvh] max-w-[90vw] bg-black" />;
  }
  if (kind === "audio") {
    return (
      <div className="pixel-panel flex flex-col items-center gap-3 p-6">
        <MusicIcon className="size-10 text-muted-foreground" />
        <span className="text-sm">{fileName(file)}</span>
        <audio key={url} src={url} controls autoPlay />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="pixel-panel flex flex-col items-center gap-3 p-6 text-sm hover:underline">
      <FileIcon className="size-10 text-muted-foreground" />
      {fileName(file)}
    </a>
  );
}
