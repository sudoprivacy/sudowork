# HyperFrames skill (hub candidate)

Packages [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)
(Apache-2.0, "Write HTML. Render video. Built for agents.") as a sudowork skill:
author an HTML composition, render a deterministic MP4.

## Why it lives here (and not in `skills/`)

`skills/**` is bundled into the app build (`electron.vite.config.ts`,
`electron-builder.yml`) — anything there ships to **every** user as a builtin.
HyperFrames is a heavy, third-party, on-demand capability, so it belongs in the
**skill hub** (downloaded into `skills/_hub/` at runtime), not bundled.

`contrib/hub-skills/` is **not** referenced by any build config, so this PR has
**zero impact on the shipped app**. It's the publishable skill package + a place
to review/test it before it goes to the hub.

## Dependency story (verified)

| Dep | How it's satisfied |
|---|---|
| Node 22+ | sudowork bundles a compatible Node (`engines.node` is `>=22 <26`) |
| npm deps (`hyperframes`) | auto-installed on first run by `scripts/render.ts` (same model as the builtin `mermaid` skill) |
| Headless Chrome | fetched on demand by HyperFrames' own `browser ensure`; the wrapper runs it before render-class commands (~150 MB, one time). NOT downloaded at npm install. |
| **FFmpeg** | hyperframes spawns a system `ffmpeg`; sudowork ships none. The skill bundles `ffmpeg-static` and puts it on `PATH` (+ `FFMPEG_PATH`) before calling the CLI — **no system ffmpeg required**. Verified: `hyperframes doctor` reports FFmpeg at the bundled `node_modules/ffmpeg-static/ffmpeg.exe`. |
| **FFprobe** | `ffmpeg-static` ships ffmpeg only; hyperframes' doctor also needs `ffprobe`. The skill adds `ffprobe-static` and injects it the same way (`FFPROBE_PATH`). |

This matches the dynamic-ffmpeg-download pattern the existing **Remotion** hub skill already uses — same convention, independent self-contained implementation (no shared cross-skill code; see "DRY" note below).

## Positioning vs. the existing Remotion skill

The hub already has a Remotion video skill. HyperFrames is added as a **free / Apache-2.0 alternative**, not a replacement:

- **License** — Remotion needs a paid company license for orgs > 3 employees (source-available); HyperFrames is Apache-2.0, free for everyone, no licensing burden on the rendered output.
- **Authoring** — Remotion is React/JSX; HyperFrames is plain HTML, which an agent generates more reliably and a user edits more easily.

### Why not DRY the ffmpeg provisioning with Remotion?

The hub model is self-contained zips (SKILL.md + scripts + icon) with no shared-library mechanism — each skill installs into its own `skills/_hub/<name>/` and is independently installed/removed/scanned. A shared ffmpeg module would break that isolation (removing one skill breaks the other; version skew). The two skills also use different upstream mechanisms (Remotion's `@remotion/renderer` vs. `ffmpeg-static`). The right level of sharing is the **convention** (dynamic ffmpeg download), which both already follow; code-level DRY would only make sense if the hub grows a first-class shared-runtime-deps feature.

## Testing locally

Import as a local skill (sudowork: 技能 → 导入本地技能 → point at this dir), or
directly:

```bash
cd contrib/hub-skills/hyperframes
npx tsx scripts/render.ts init demo
npx tsx scripts/render.ts render
```

First run downloads Chromium + ffmpeg-static.

## Open items for the hub owner (@张所超)

1. **Provision approach** — is `ffmpeg-static` (per-platform static binary fetched
   on first run) acceptable, or does the hub prefer a different ffmpeg strategy
   (e.g. no first-run network download)?
2. **Where hub-skill sources live** — if hub skills are sourced from a different
   repo/location, this package ports as-is; only its path changes.
3. **Packaging/meta conventions** — checksum, required `_sudowork_meta.json`
   fields, directory layout for the published zip.

Final hub publish is the hub owner's call; this PR is the reviewable artifact.
