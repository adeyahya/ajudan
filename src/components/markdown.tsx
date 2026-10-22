"use client";

import type { ComponentProps } from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import { mediaKind } from "@/lib/media-types";
import { cn } from "@/lib/utils";

const fileHref = (businessId: string, rel: string) =>
  `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

/** "images/a.png" seen from "work/x.md" → "work/images/a.png" (null for web links). */
function resolveRelative(from: string, url: string) {
  if (/^[a-z]+:|^\/\/|^#/i.test(url)) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of decodeURI(url).split("?")[0].split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Images as images, linked videos as players. */
function ImageOrVideo({ src, alt }: { src?: string | Blob; alt?: string }) {
  const url = typeof src === "string" ? src : "";
  if (mediaKind(url.split("?")[0]) === "video") {
    return <video src={url} controls playsInline className="my-2 max-h-[70vh] max-w-full rounded-lg bg-stage" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- local files from the business folder
  return <img src={url} alt={alt ?? ""} className="my-2 max-h-[70vh] max-w-full" loading="lazy" />;
}

// Without "harden": it blocks relative image URLs (our own files). The sanitizer still
// removes scripts and javascript: links.
const FILE_REHYPE = [defaultRehypePlugins.raw, defaultRehypePlugins.sanitize];

// Streamdown's component map is typed loosely (any element name → any props).
const FILE_COMPONENTS = { img: ImageOrVideo } as unknown as NonNullable<ComponentProps<typeof Streamdown>["components"]>;

/**
 * Markdown from a file in the business folder (Files tab): relative images and links
 * point at the folder's files, and a linked video plays in place.
 */
export function FileMarkdown({ children, businessId, path, className }: { children: string; businessId: string; path: string; className?: string }) {
  const transform = (url: string) => {
    const rel = resolveRelative(path, url);
    return rel ? fileHref(businessId, rel) : url;
  };
  return (
    <Markdown
      className={className}
      urlTransform={transform}
      components={FILE_COMPONENTS}
      rehypePlugins={FILE_REHYPE}
    >
      {children}
    </Markdown>
  );
}

/** Renders model-written markdown (agent replies, task results, deliverables). */
export function Markdown({
  children,
  className,
  urlTransform,
  components,
  rehypePlugins,
}: {
  children: string;
  className?: string;
  urlTransform?: ComponentProps<typeof Streamdown>["urlTransform"];
  components?: ComponentProps<typeof Streamdown>["components"];
  rehypePlugins?: ComponentProps<typeof Streamdown>["rehypePlugins"];
}) {
  return (
    <Streamdown
      urlTransform={urlTransform}
      components={components}
      rehypePlugins={rehypePlugins}
      className={cn(
        // Prose (UI-PLAN §2.2): 15/24 body, headings 20/16/15 600, code 13 mono, hairline rules.
        // Pass className="text-[13px] leading-5" for compact panels.
        "text-[15px] leading-6 text-foreground [overflow-wrap:anywhere]",
        "[&_h1]:text-xl [&_h1]:leading-7 [&_h2]:text-base [&_h2]:leading-6 [&_h3]:text-[15px] [&_h3]:leading-6 [&_h1,&_h2,&_h3]:font-semibold [&_h1,&_h2,&_h3]:tracking-[-0.005em] [&_h1,&_h2,&_h3]:mt-5 [&_h1,&_h2,&_h3]:mb-1.5",
        "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_hr]:my-4 [&_hr]:border-border",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13px] [&_:not(pre)>code]:text-destructive",
        "[&_img]:rounded-lg [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      {children}
    </Streamdown>
  );
}
