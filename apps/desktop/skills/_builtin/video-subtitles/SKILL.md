---
name: video-subtitles
description: Generate timed subtitles from video or audio, translate their text, and burn subtitles into a new video. Use for captions, SRT, video subtitles, or adding translated subtitles in Sudowork desktop or WebUI cloud conversations.
---

# Video subtitles

Run this skill's CLI from this directory. Desktop local conversations use the app's managed speech recognition and encoder. WebUI cloud conversations process uploaded media inside the cloud runtime. Dependencies and the speech model may take several minutes to prepare on first use.

In WebUI, use the uploaded file's workspace path supplied by the conversation. Put all outputs inside that same conversation workspace so the user can download them. Never use a path from the user's computer in a cloud command.

On Windows, use the PowerShell tool. Invoke a quoted Node executable with `& "C:/path/to/node.exe"`; the command arguments below work in PowerShell too. Create the output directory first. Progress is written to stderr; use the exit code and JSON result to determine success.

## Generate subtitles

```bash
node scripts/subtitles.mjs transcribe --input "/absolute/path/video.mp4" --output "/absolute/path/captions.srt"
```

The source language is detected automatically. Supply `--language en` only when the source language is known. `--model small` is the default; larger models require more memory and time. Audio files are accepted too.

The command returns the saved SRT path and detected source language. Read the SRT file to review the transcript. Report a failed command accurately; an empty or missing output is not a completed transcription.

## Translate when requested

Use your current language capabilities to translate the cue text into the requested language. Save a separate UTF-8 SRT file, preserving every cue number and timestamp exactly. Keep sentences concise enough to read during their cues. Review the translation before burning it. Keep the original transcript available.

## Burn subtitles

```bash
node scripts/subtitles.mjs burn --input "/absolute/path/video.mp4" --subtitles "/absolute/path/captions-translated.srt" --output "/absolute/path/video-subtitled.mp4"
```

Use a new output filename: existing files are never overwritten. The app prepares its managed video encoder on demand. Commands can take several minutes; wait for the original command to finish instead of launching duplicates. If the agent shell backgrounds the command, poll that same process until it exits.

## Deliver

Check the finished video's duration, audio track, and a frame showing the subtitles before calling the task complete. In your final reply, include a Markdown link for each output using its full absolute path, for example `[Subtitled video](C:/output/video-subtitled.mp4)` and `[Translated subtitles](C:/output/captions-translated.srt)`. Preserve the source media. Mention unclear speech or translation ambiguities for review. Frame analysis and lip synchronization require a separate workflow.

## Cloud runtime setup

The Linux cloud runtime needs Python 3.10+, FFmpeg with libass, and CJK fonts. Its administrator prepares these once. Speech recognition uses CPU int8 with two threads. The CLI uses the runtime image's `/opt/sudowork-subtitles/bin/python` or `~/.cache/sudowork/subtitles/venv/bin/python`; `SUDOWORK_SUBTITLE_PYTHON` overrides either. The image can provide the small model at `/opt/sudowork-models/faster-whisper-small` (`SUDOWORK_WHISPER_MODEL_DIR` overrides it). To prepare the isolated Python environment on another Linux host:

```bash
python3 -m venv "$HOME/.cache/sudowork/subtitles/venv"
"$HOME/.cache/sudowork/subtitles/venv/bin/python" -m pip install -r scripts/requirements-cloud.txt
```

If the runtime is missing system packages, report the missing dependency to the administrator. Do not claim success or substitute invented subtitle text. Keep credentials out of messages and logs.
