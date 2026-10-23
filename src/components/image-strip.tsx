"use client";

import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FileIcon, MusicIcon, PlayIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import { useT } from "@/components/i18n";
import { IconButton } from "@/components/kit";
import { thumbUrl } from "@/lib/file-urls";
import { mediaKind } from "@/lib/media-types";
import { cn } from "@/lib/utils";

/** URL for a file in the open business folder, e.g. "work/images/slide-1.png". */
export const fileUrl = (businessId: string, rel: string) =>
  `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

const fileName = (rel: string) => rel.split("/").pop() ?? rel;

/** Small preview of one file: image, first video frame, or an icon. */
function Thumb({ businessId, file, label }: { businessId: string; file: string; label?: string }) {
  const kind = mediaKind(file);
  return (
    <>
      {kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
        <img src={thumbUrl(businessId, file)} alt={fileName(file)} className="size-full object-cover" loading="lazy" />
      )}
      {kind === "video" && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- local files from the business folder */}
          <img src={thumbUrl(businessId, file)} alt={fileName(file)} className="size-full object-cover" loading="lazy" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              <PlayIcon className="size-4 translate-x-px fill-current" />
            </span>
          </span>
        </>
      )}
      {(kind === "audio" || kind === "file") && (
        <span className="flex size-full flex-col items-center justify-center gap-1 p-1.5 text-tertiary">
          {kind === "audio" ? <MusicIcon className="size-5" /> : <FileIcon className="size-5" />}
          <span className="line-clamp-2 text-center text-[11px] leading-[14px] break-all text-muted-foreground">{fileName(file)}</span>
        </span>
      )}
      {label && (
        <span className="absolute bottom-1 left-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-black/55 px-1 text-[11px] leading-[14px] font-medium text-white tabular-nums">
          {label}
        </span>
      )}
    </>
  );
}

/**
 * Thumbnails of a piece of work's files (carousel slides, videos, footage). Click one
 * to view it full screen (videos play), flip through with ← →, Esc closes, or download it.
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

  if (!images.length) return null;
  const current = open === null ? null : images[open];
  const step = (d: number) => setOpen((i) => (i === null ? i : (i + d + images.length) % images.length));
  return (
    <>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {images.map((img, i) => (
          <button
            key={img}
            type="button"
            onClick={() => setOpen(i)}
            className="relative overflow-hidden rounded-md bg-muted ring-1 ring-black/5 ring-inset transition-opacity duration-100 hover:opacity-90"
            style={{ width: size, height: Math.round(size * 1.25) }}
            title={fileName(img)}
          >
            <Thumb businessId={businessId} file={img} label={images.length > 1 ? String(i + 1) : undefined} />
          </button>
        ))}
      </div>

      <DialogPrimitive.Root open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,15,15,0.88)] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") step(1);
              if (e.key === "ArrowLeft") step(-1);
            }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98]"
            onClick={(e) => e.target === e.currentTarget && setOpen(null)}
          >
            <DialogPrimitive.Title className="sr-only">{current ? fileName(current) : t("ui.mediaViewer")}</DialogPrimitive.Title>
            {current && <Viewer businessId={businessId} file={current} />}
            {open !== null && current && (
              <div className="flex items-center gap-1 rounded-lg bg-black/40 p-1 text-white backdrop-blur-sm [&_button]:text-white/80 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
                {images.length > 1 && (
                  <IconButton label={t("ui.previous")} side="top" onClick={() => step(-1)}>
                    <ChevronLeftIcon />
                  </IconButton>
                )}
                <span className="min-w-12 px-1 text-center text-[13px] text-white/80 tabular-nums">
                  {open + 1} / {images.length}
                </span>
                {images.length > 1 && (
                  <IconButton label={t("ui.next")} side="top" onClick={() => step(1)}>
                    <ChevronRightIcon />
                  </IconButton>
                )}
                <IconButton label={t("ui.download")} side="top" asChild>
                  <a href={fileUrl(businessId, current)} download={fileName(current)}>
                    <DownloadIcon />
                  </a>
                </IconButton>
                <DialogPrimitive.Close asChild>
                  <IconButton label={t("ui.close")} side="top">
                    <XIcon />
                  </IconButton>
                </DialogPrimitive.Close>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

function Viewer({ businessId, file }: { businessId: string; file: string }) {
  const url = fileUrl(businessId, file);
  const kind = mediaKind(file);
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
    return <img src={url} alt={fileName(file)} className="max-h-[calc(100dvh-6rem)] max-w-full rounded-md object-contain" />;
  }
  if (kind === "video") {
    return <video key={url} src={url} controls autoPlay playsInline className="max-h-[calc(100dvh-6rem)] max-w-full rounded-md bg-stage" />;
  }
  if (kind === "audio") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg bg-background p-6 shadow-dialog">
        <MusicIcon className="size-8 text-tertiary" />
        <span className="text-sm text-foreground">{fileName(file)}</span>
        <audio key={url} src={url} controls autoPlay />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-3 rounded-lg bg-background p-6 text-sm text-foreground shadow-dialog hover:underline">
      <FileIcon className="size-8 text-tertiary" />
      {fileName(file)}
    </a>
  );
}
