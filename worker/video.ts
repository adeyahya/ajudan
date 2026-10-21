/**
 * Renders a teammate's Remotion video to MP4. The teammate writes one TSX file that
 * default-exports the video component and exports `video = { width, height, fps,
 * durationInFrames }`; this module generates the Remotion entry around it, bundles it
 * with Ajudan's own node_modules (teammates have no npm or shell) and renders with
 * your installed Chrome.
 *
 * Footage and images are reached with staticFile() at the same folder-relative path
 * a teammate attaches: "media/<file>" (what the owner uploaded), "work/images/<file>"
 * (rendered images) and "work/videos/<file>" (earlier renders).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { CHROME_PATH } from "@/lib/browser";
import { dataDir } from "@/lib/paths";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MODULES = path.join(ROOT, "node_modules");

export type RenderVideoResult = { outPath: string; width: number; height: number; fps: number; durationInFrames: number };

let queue: Promise<unknown> = Promise.resolve();

/** One render at a time: each uses all CPU cores. */
export function renderVideo(opts: Parameters<typeof renderNow>[0]): Promise<RenderVideoResult> {
  const next = queue.then(() => renderNow(opts));
  queue = next.catch(() => {});
  return next;
}

async function renderNow(opts: {
  /** Absolute path of the teammate's TSX file. */
  source: string;
  outPath: string;
  /** Scratch folder for the generated entry and bundle. */
  workDir: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<RenderVideoResult> {
  fs.rmSync(opts.workDir, { recursive: true, force: true });
  fs.mkdirSync(opts.workDir, { recursive: true });

  // Public folder: links to the media library and the team's images and videos only.
  const publicDir = path.join(opts.workDir, "public");
  for (const rel of ["media", "work/images", "work/videos"]) {
    const target = path.join(dataDir(), rel);
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.dirname(path.join(publicDir, rel)), { recursive: true });
    fs.symlinkSync(target, path.join(publicDir, rel));
  }

  const entry = path.join(opts.workDir, "entry.tsx");
  fs.writeFileSync(
    entry,
    `import React from "react";
import { Composition, registerRoot } from "remotion";
import Video, { video } from ${JSON.stringify(opts.source.replace(/\.tsx?$/, ""))};

const Root = () => <Composition id="Main" component={Video} {...video} />;
registerRoot(Root);
`,
  );

  const serveUrl = await bundle({
    entryPoint: entry,
    publicDir,
    symlinkPublicDir: true,
    outDir: path.join(opts.workDir, "bundle"),
    onSymlinkDetected: () => {},
    // The teammate's file lives outside this repo: resolve remotion, react and
    // @remotion/* from Ajudan's node_modules.
    webpackOverride: (config) => ({
      ...config,
      resolve: { ...config.resolve, modules: [NODE_MODULES, "node_modules"] },
      resolveLoader: { ...config.resolveLoader, modules: [NODE_MODULES, "node_modules"] },
    }),
  });

  const composition = await selectComposition({ serveUrl, id: "Main", browserExecutable: CHROME_PATH, logLevel: "error" });
  if (composition.durationInFrames > composition.fps * 180) {
    throw new Error(`The video is ${Math.round(composition.durationInFrames / composition.fps)}s; keep it under 3 minutes.`);
  }
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  const cancel = makeCancel(opts.signal);
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: opts.outPath,
    browserExecutable: CHROME_PATH,
    logLevel: "error",
    onProgress: ({ progress }) => opts.onProgress?.(progress),
    cancelSignal: cancel,
  });
  fs.rmSync(path.join(opts.workDir, "bundle"), { recursive: true, force: true });
  return {
    outPath: opts.outPath,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
  };
}

function makeCancel(signal?: AbortSignal) {
  return (callback: () => void) => {
    if (!signal) return;
    if (signal.aborted) callback();
    else signal.addEventListener("abort", callback, { once: true });
  };
}
