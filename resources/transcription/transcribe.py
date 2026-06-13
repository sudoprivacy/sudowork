"""sudowork shared voice-transcription helper.

Invoked by the TypeScript TranscriptionService (local engine) as:

    python3 transcribe.py --audio <path> [--codec silk|amr|mp3|...] \
        [--engine faster-whisper|sensevoice] [--model <name>] [--language <lang>]

Pipeline:
  1. Decode the input to a 16-bit mono WAV the ASR engine can read.
     - SILK (Tencent/WeChat voice) is decoded via `pilk`; nothing else can read it.
     - Everything else is left to the engine's own ffmpeg/PyAV decoder.
  2. Run the selected CPU-only ASR engine. Models download lazily on first run.
  3. Emit a single JSON object to stdout: {"text": "...", "engine": "...", "language": "..."}.

On failure, emit {"error": "..."} to stdout and exit non-zero. The caller treats
any non-zero exit (or unparseable stdout) as "transcription unavailable" and falls
back to the `[voice message]` placeholder, so this script must never hang.

This file is intentionally dependency-light at import time: heavy ASR libraries are
imported lazily inside the engine functions so `--help` / arg errors stay fast and a
missing engine package produces a clean error instead of an import traceback.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile


# SILK V3 streams start with an optional 1-byte Tencent prefix (0x02) followed
# by the ASCII magic "#!SILK_V3". Detect by content, not just the declared codec,
# because WeChat voice is downloaded with a `.amr` extension but is actually SILK.
_SILK_MAGIC = b"#!SILK_V3"


def _is_silk(path: str, codec: str | None) -> bool:
    if codec and codec.lower() in ("silk", "silk_v3", "v3"):
        return True
    try:
        with open(path, "rb") as fh:
            head = fh.read(16)
    except OSError:
        return False
    return _SILK_MAGIC in head[:10]


def _decode_silk_to_wav(silk_path: str, pcm_rate: int = 24000) -> str:
    """Decode a SILK file to a 16-bit mono WAV using pysilk, returning the wav path.

    WeChat voice is sampled at 24 kHz. We use `pysilk-mod` rather than `pilk`
    because pysilk-mod ships prebuilt wheels (incl. Windows / cp313) so no C
    compiler is needed on the user's machine, and it decodes straight to a WAV
    container via `to_wav=True`.

    Tencent prepends a 0x02 byte before the `#!SILK_V3` magic; pysilk's own
    `is_silk_data` check expects that prefix, so we pass the file bytes verbatim.
    """
    try:
        import pysilk  # type: ignore  (provided by the `pysilk-mod` package)
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "pysilk is required to decode SILK voice (pip install pysilk-mod)"
        ) from exc

    with open(silk_path, "rb") as fh:
        silk_data = fh.read()
    wav_bytes = pysilk.decode(silk_data, to_wav=True, sample_rate=pcm_rate)

    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(wav_bytes)
    except Exception:
        try:
            os.remove(wav_path)
        except OSError:
            pass
        raise
    return wav_path


def _transcribe_faster_whisper(audio_path: str, model: str, language: str | None) -> str:
    """Transcribe with faster-whisper (CTranslate2, CPU int8)."""
    from faster_whisper import WhisperModel  # type: ignore

    # Default to "small": "base" badly mis-recognizes Mandarin (e.g. 测试→做事 on a
    # real WeChat clip), while "small" is accurate and emits Simplified Chinese for
    # only ~1s more on CPU. Override via the assistant.transcription.model config.
    whisper = WhisperModel(model or "small", device="cpu", compute_type="int8")
    segments, _info = whisper.transcribe(
        audio_path,
        language=language or None,
        beam_size=5,
        vad_filter=True,
    )
    return "".join(seg.text for seg in segments).strip()


def _transcribe_sensevoice(audio_path: str, model: str, language: str | None) -> str:
    """Transcribe with SenseVoice via FunASR (stronger + faster for Chinese)."""
    from funasr import AutoModel  # type: ignore
    from funasr.utils.postprocess_utils import rich_transcription_postprocess  # type: ignore

    am = AutoModel(model=model or "iic/SenseVoiceSmall", disable_update=True, device="cpu")
    res = am.generate(
        input=audio_path,
        language=language or "auto",
        use_itn=True,
    )
    if not res:
        return ""
    return rich_transcription_postprocess(res[0]["text"]).strip()


_ENGINES = {
    "faster-whisper": _transcribe_faster_whisper,
    "sensevoice": _transcribe_sensevoice,
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="sudowork voice transcription helper")
    parser.add_argument("--audio", required=True, help="path to the input audio file")
    parser.add_argument("--codec", default=None, help="declared source codec hint (e.g. silk, amr)")
    parser.add_argument("--engine", default="faster-whisper", choices=sorted(_ENGINES))
    parser.add_argument("--model", default="", help="engine-specific model name/path")
    parser.add_argument("--language", default=None, help="language hint (e.g. zh, en); auto if omitted")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.audio):
        print(json.dumps({"error": f"audio not found: {args.audio}"}))
        return 2

    wav_to_clean: str | None = None
    try:
        audio_path = args.audio
        if _is_silk(audio_path, args.codec):
            audio_path = _decode_silk_to_wav(audio_path)
            wav_to_clean = audio_path

        engine_fn = _ENGINES[args.engine]
        text = engine_fn(audio_path, args.model, args.language)
        print(json.dumps({"text": text, "engine": args.engine, "language": args.language or "auto"}))
        return 0
    except Exception as exc:  # noqa: BLE001 - surface any failure as structured JSON
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        return 1
    finally:
        if wav_to_clean:
            try:
                os.remove(wav_to_clean)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
