"""Media operations for Linux cloud agent workspaces; no credential access."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def timestamp(seconds: float) -> str:
    if not math.isfinite(seconds):
        raise ValueError("Subtitle timestamps must be finite")
    milliseconds = round(max(0, seconds) * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


def build_srt(segments) -> str:
    cues = []
    for segment in segments:
        text = " ".join(segment.text.split())
        start, end = timestamp(segment.start), timestamp(segment.end)
        if text and segment.end > max(0, segment.start) and start != end:
            cues.append(f"{len(cues) + 1}\n{start} --> {end}\n{text}")
    if not cues:
        raise ValueError("No speech was detected; no subtitle file was created")
    return "\n\n".join(cues) + "\n"


def publish(staged: Path, output: Path) -> None:
    """Atomically publish without replacing an existing file or symlink."""
    os.link(staged, output)


def run(args) -> dict:
    source = Path(args.input).resolve(strict=True)
    output = Path(args.output).absolute()
    if not source.is_file():
        raise ValueError("Input must be a file")
    if os.path.lexists(output):
        raise FileExistsError("Output already exists; choose a new filename")
    suffix = ".srt" if args.command == "transcribe" else ".mp4"
    if output.suffix.lower() != suffix:
        raise ValueError(f"Output must end with {suffix}")
    if args.command == "burn" and (not args.subtitles or args.language or args.model):
        raise ValueError("Burn requires --subtitles and does not accept --language or --model")
    if args.command == "transcribe" and args.subtitles:
        raise ValueError("Transcribe does not accept --subtitles")
    # The output's own filesystem supports an atomic, no-replace hard link.
    with tempfile.TemporaryDirectory(prefix=".subtitles-", dir=output.parent) as temp:
        stage = Path(temp)
        result = {"outputPath": str(output)}
        if args.command == "transcribe":
            from faster_whisper import WhisperModel

            model_name = args.model or "small"
            prepared_model = os.environ.get("SUDOWORK_WHISPER_MODEL_DIR", "/opt/sudowork-models/faster-whisper-small")
            if model_name == "small" and Path(prepared_model).is_dir():
                model_name = prepared_model
            model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=2)
            segments, info = model.transcribe(str(source), language=args.language, beam_size=5, vad_filter=True)
            staged = stage / "captions.srt"
            staged.write_text(build_srt(segments), encoding="utf-8")
            result["language"] = info.language
        else:
            captions = Path(args.subtitles).resolve(strict=True)
            if not captions.is_file() or not 0 < captions.stat().st_size <= 16 * 1024 * 1024:
                raise ValueError("Subtitles must be a nonempty SRT file under 16 MB")
            if captions.suffix.lower() != ".srt":
                raise ValueError("Subtitles must be an SRT file")
            ffmpeg = shutil.which("ffmpeg")
            if not ffmpeg:
                raise RuntimeError("Cloud runtime needs FFmpeg with libass and CJK fonts; ask its administrator to prepare it")
            shutil.copyfile(captions, stage / "captions.srt")
            staged = stage / "video.mp4"
            subprocess.run([
                ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
                "-i", str(source), "-map", "0:v:0", "-map", "0:a?",
                "-vf", "subtitles=filename=captions.srt:charenc=UTF-8",
                "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-movflags", "+faststart", str(staged),
            ], cwd=stage, check=True, timeout=45 * 60, stdout=sys.stderr)
        publish(staged, output)
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["transcribe", "burn"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--subtitles")
    parser.add_argument("--language")
    parser.add_argument("--model", choices=["tiny", "base", "small", "medium", "large-v3", "turbo"])
    args = parser.parse_args()
    try:
        print(json.dumps({"success": True, "data": run(args)}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"success": False, "msg": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
