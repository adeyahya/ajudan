---
name: campaign-video
description: Make campaign videos (TikTok, Reels, Shorts, ads, product demos) in Ajudan with Remotion, using the owner's footage and photos. Use for any video work, and before asking the owner for footage. Overrides the setup, preview and render steps of remotion-best-practices.
---

# Campaign videos in Ajudan

You edit videos as code with Remotion. You have **no shell and no npm**: never run `npx`, `npm`, `remotion studio` or `remotion render`, and never scaffold a project. Ajudan does the bundling and rendering for you with the `render_video` tool. Use `remotion-best-practices` for Remotion APIs (its `rules/*.md` files), but this skill decides how files, footage and rendering work here.

## Workflow

1. **Brief.** Goal, platform, length, hook, offer and call to action, in the business's language and brand voice (BUSINESS.md).
2. **Footage.** Look at what the owner attached (listed in your task) and what's in the media library (`list_media`). For each clip, `inspect_media` (duration, size, fps, sound), then `extract_frames` and Read a few frames to *see* it. Pick the best moments with timestamps.
3. **Missing footage?** If the video needs shots you don't have, don't fake them with stock or AI imagery of the product. If the team has a human teammate who films (see "Human teammates" in your instructions), send them the **shot list** with `ask_human`; their clips come back to you as a new task. Otherwise ask the owner. Save the plan with save_deliverable either way. You can still make a text, motion-graphics or photo-based version if the owner wants something now.
4. **Music and sound.** Unless the owner said no music, find a fitting track with `find_free_assets(type: "music")` and download it (see "Music and sound effects"). Add a few sound effects (whoosh on transitions, pop on text) if they fit the brand.
5. **Edit.** Write one TSX file under `work/video/<name>/Video.tsx` (the file contract is below).
6. **Render.** `render_video` → `work/videos/<name>.mp4`. Errors come back verbatim: fix the file and render again.
7. **Check.** `extract_frames` on your render (the hook, the middle, the end card) and Read them: text readable, inside safe zones, nothing cut off, the right clips. Fix and re-render if needed. Two or three rounds is normal.
8. **Deliver.** save_deliverable with the caption (including any required music credit), hashtags, cover text and posting notes, and `images: ["work/videos/<name>.mp4", …]` (videos and images both go in `images`). Say in your summary what footage you used and what you'd change with better footage.

## File contract

```tsx
// work/video/promo-nama/Video.tsx
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { Video as Clip, Audio } from "@remotion/media";
import { loadFont } from "@remotion/google-fonts/Poppins";

const { fontFamily } = loadFont("normal", { weights: ["600", "800"], subsets: ["latin"] });

// Required: the composition settings.
export const video = { width: 1080, height: 1920, fps: 30, durationInFrames: 30 * 15 };

// Required: the default export is the video.
export default function Video() {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#111" }}>
      <Sequence durationInFrames={3 * fps}>
        <Clip src={staticFile("media/2026-10-22-unboxing-a1b2c3.mp4")} trimBefore={2 * fps} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </Sequence>
      {/* … */}
    </AbsoluteFill>
  );
}
```

- `staticFile()` takes the **same path you'd attach**: `media/<file>` (owner footage, photos, music), `work/images/<file>` (images you rendered), `work/videos/<file>` (earlier renders). Product photos by https URL also work.
- You can split code into more files next to Video.tsx and import them relatively.
- Installed packages (nothing else can be imported): `remotion`, `@remotion/media` (Video, Audio), `@remotion/transitions`, `@remotion/google-fonts`, `@remotion/media-utils`, `@remotion/shapes`, `@remotion/paths`, `@remotion/captions`, `@remotion/layout-utils`, `@remotion/light-leaks`, `react`. Not available: Tailwind, three.js, Lottie, Mapbox, Mediabunny. Use `inspect_media` instead of Mediabunny for durations and sizes, and `transcribe_media` instead of the Whisper rules for captions.
- Animate only with `useCurrentFrame()`, `interpolate()` and `spring()`. CSS animations and transitions don't render.
- Max 3 minutes. Load only the font weights you use.

## Platform specs

| Where | Size | Length | Notes |
|---|---|---|---|
| TikTok, Reels, Shorts | 1080×1920 (9:16), 30 fps | 9–30 s (up to 60 s) | Keep text out of the top 220 px and bottom 420 px, and 120 px from the right edge (UI buttons). |
| Feed post | 1080×1350 (4:5) | 15–45 s | |
| Story ads | 1080×1920 | 5–15 s | |
| YouTube, website | 1920×1080 (16:9) | any | |

## What makes campaign videos work

- **The hook is the first 1–2 seconds:** movement, a face, the product in hand, or a bold question or claim as big on-screen text. No logo intros.
- **One message per video,** shown on screen (most people watch muted): 3–7 words per caption card, big (64–96 px at 1080 wide), high contrast, with a subtle shadow or a box behind it.
- **Cut fast:** a new shot or visual change every 1.5–3 s. Trim dead air and fumbling. Use J-cuts and L-cuts if there's speech.
- **Show the product being used and its details:** close-ups, hands, the before and after, the price.
- **End card for the last 2–3 s:** the offer and the call to action (where to buy: website, Shopee, WhatsApp), the logo, the handle.
- **Sound:** a Reel or TikTok without sound feels unfinished. Keep the owner's original audio when it's speech or a satisfying product sound (clicks, printing), and put music under it.
- **Speech:** caption it. `transcribe_media(file, captions: true)` writes a timed `.srt` next to the footage. Load it with `staticFile`, parse it with `parseSrt` from `@remotion/captions`, and show each caption in its time window. Check names and prices in the transcript: they may be misheard.

## Music and sound effects

You can't use popular songs (copyright). Use music the owner uploaded (`media/…mp3`) or free tracks:

1. `find_free_assets({ type: "music", query, min_seconds, max_seconds })`. Search in English with mood + genre + instrument: "upbeat happy ukulele", "lofi chill hip hop", "energetic electronic pop", "cute playful", "corporate inspiring". Ask for tracks at least as long as the video (`min_seconds`). Try 2–3 queries if the first results don't fit.
2. You can't listen, so judge by title, length and source, and keep the choice safe: positive, mid-tempo instrumentals suit product videos. Say in your summary which track you picked and why, so the owner can ask for another.
3. `download_free_asset(id, "music")` → `media/…mp3`.
4. Sound effects the same way with `type: "sound_effect"` ("whoosh", "pop", "click", "ding", "camera shutter"), usually under 3 s.

In the video, use `<Audio>` from `@remotion/media`:

```tsx
import { Audio } from "@remotion/media";
import { interpolate, staticFile, useVideoConfig } from "remotion";

const { fps, durationInFrames } = useVideoConfig();
// Fade in for 0.5 s, fade out over the last 1 s; quieter (0.25) under speech or product sounds.
<Audio
  src={staticFile("media/2026-10-22-hola-NB5XbL.mp3")}
  trimBefore={8 * fps}        // start at a lively part instead of the intro
  volume={(f) => interpolate(f, [0, 0.5 * fps, durationInFrames - fps, durationInFrames], [0, 0.6, 0.6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
/>
<Sequence from={2 * fps} durationInFrames={fps} layout="none"><Audio src={staticFile("media/…whoosh.mp3")} volume={0.5} /></Sequence>
```

- Music volume 0.5–0.7 alone, 0.15–0.3 under speech or product sounds. Always fade out at the end; never cut mid-note.
- Cut on the beat if you can tell where it is; otherwise cut every ~1.5–2.5 s, which feels rhythmic with most mid-tempo tracks.
- **Credits:** CC BY tracks need credit. `download_free_asset` gives the line; put it at the end of the caption (e.g. `🎵 "Hola" by Square a Saw (CC BY 3.0)`). CC0 and public domain need none.
- The owner can still swap in a trending sound in the TikTok or Instagram app; mention it in the posting notes as an option, not as the plan.

## Asking the owner for footage

Be specific and easy to shoot on a phone. For each shot give the shot, its length and how to shoot it. For example:

1. Close-up of hands taking a keychain out of the package: 5 s, vertical, natural light by a window.
2. The 3D printer printing a name: 10 s, steady (phone leaning on something), close to the nozzle.
3. Three finished keychains with different names on a plain background: 5 s, slow pan.

Send it to the human teammate who films with `ask_human` (or to the owner if there's none). General tips to include: film vertical (9:16), 1080p or 4K at 30 fps, clean the lens, keep the phone steady, record 2–3 s before and after the action, and film more takes than needed. Ask them to send the clips in the same WhatsApp chat (human teammates) or drop them into the chat with the manager (owner). WhatsApp compresses video: ask for "send as document" when quality matters.
