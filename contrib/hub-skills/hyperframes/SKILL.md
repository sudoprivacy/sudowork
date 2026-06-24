---
name: hyperframes
description: Render MP4 videos from plain HTML/CSS/animations using HyperFrames. Use when the user wants to create a video, animated clip, explainer, slideshow-to-video, social media video, or motion graphics — you author a standard HTML composition and render it to a deterministic MP4. No video-editing skills or proprietary timeline needed; FFmpeg is provisioned automatically.
---

# HyperFrames — HTML → MP4 Video

Turn a plain HTML file (with CSS, animations, images, Lottie/GSAP/Three.js) into a
deterministic MP4. You write the composition as HTML; HyperFrames captures frames
with headless Chrome and encodes them with FFmpeg.

Upstream: <https://github.com/heygen-com/hyperframes> (Apache-2.0).

## Quick Start

> First run installs `hyperframes` + a bundled `ffmpeg` (`ffmpeg-static`) + `ffprobe`
> (`ffprobe-static`) into the skill dir. The first render also fetches a headless
> Chrome via HyperFrames' own `browser ensure` (~150 MB, one time). Subsequent runs
> are fast. **The user does NOT need FFmpeg, FFprobe, or Chrome installed** — all are
> provisioned by the skill.

All commands go through the wrapper, which guarantees FFmpeg is on PATH before
delegating to the HyperFrames CLI:

```bash
# 1. Scaffold a new video project (creates an HTML composition + frame.md)
npx tsx scripts/render.ts init my-video

# 2. (optional) Live browser preview while you edit the HTML
npx tsx scripts/render.ts preview

# 3. Render the composition to MP4
npx tsx scripts/render.ts render
```

Any argument after the subcommand is passed straight through to `hyperframes`
(e.g. `npx tsx scripts/render.ts render --out out.mp4`). See
`npx tsx scripts/render.ts --help` for the full upstream CLI surface.

## Authoring model

A composition is one HTML file. Timing/animation is expressed with `data-*`
attributes and standard web animation (CSS keyframes, WAAPI, GSAP, Lottie,
anime.js, Three.js). Same input → same MP4 (deterministic), so a render is
reproducible.

Typical agent flow: scaffold with `init`, write/edit the HTML composition to
match the user's request, then `render` to produce the MP4 and hand the file back.

## Notes & limits

- **Requires Node 22+** (sudowork bundles a compatible Node).
- First render pulls Chrome (via `browser ensure`) + ffmpeg/ffprobe; warn the user it may take a minute.
- Heavy 3D/Three.js scenes are slower to capture frame-by-frame.
- For distributed/Lambda rendering see upstream docs; the local path is the default here.

## Resources

- `scripts/render.ts` — wrapper that provisions ffmpeg (via `ffmpeg-static`) and runs the HyperFrames CLI
- `_sudowork_meta.json` — skill-store metadata
