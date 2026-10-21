"use client";

import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** URL for a file in the open business folder, e.g. "work/images/slide-1.png". */
export const fileUrl = (businessId: string, rel: string) =>
  `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

/**
 * Thumbnails of a piece of work's images (e.g. carousel slides). Click one to view it
 * large, flip through with ← →, or download it.
 */
export function ImageStrip({
  businessId,
  images,
  size = 96,
  className,
}: {
  businessId: string;
  images: string[];
  size?: number;
  className?: string;
}) {
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
            title={img.split("/").pop()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local files from the business folder */}
            <img src={fileUrl(businessId, img)} alt={`Image ${i + 1}`} className="size-full object-cover" loading="lazy" />
            <span className="font-pixel absolute bottom-0 left-0 bg-ink/80 px-1 text-[10px] text-parchment">{i + 1}</span>
          </button>
        ))}
      </div>

      {open !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-label="Image viewer"
        >
          <div className="relative flex max-h-full max-w-full flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local files from the business folder */}
            <img
              src={fileUrl(businessId, images[open])}
              alt={`Image ${open + 1}`}
              className="pixel-frame max-h-[80dvh] max-w-[90vw] object-contain"
            />
            <div className="flex items-center gap-2">
              {images.length > 1 && (
                <Button variant="outline" size="icon" onClick={() => setOpen((open - 1 + images.length) % images.length)} aria-label="Previous">
                  <ChevronLeftIcon />
                </Button>
              )}
              <span className="font-pixel text-sm text-parchment">
                {open + 1} / {images.length}
              </span>
              {images.length > 1 && (
                <Button variant="outline" size="icon" onClick={() => setOpen((open + 1) % images.length)} aria-label="Next">
                  <ChevronRightIcon />
                </Button>
              )}
              <Button asChild variant="outline" size="icon" aria-label="Download">
                <a href={fileUrl(businessId, images[open])} download={images[open].split("/").pop()}>
                  <DownloadIcon />
                </a>
              </Button>
              <Button variant="outline" size="icon" onClick={() => setOpen(null)} aria-label="Close">
                <XIcon />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
