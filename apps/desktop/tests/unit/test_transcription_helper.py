"""Subtitle contracts without downloading speech models."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "resources" / "transcription" / "transcribe.py"
spec = importlib.util.spec_from_file_location("transcribe", SCRIPT)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class SubtitleTests(unittest.TestCase):
    def test_timestamp_rounding(self):
        self.assertEqual(helper._format_timestamp_srt(-1), "00:00:00,000")
        self.assertEqual(helper._format_timestamp_srt(59.9996), "00:01:00,000")
        self.assertEqual(helper._format_timestamp_srt(3600.125), "01:00:00,125")
        with self.assertRaises(ValueError):
            helper._format_timestamp_srt(float("nan"))

    def test_cues_are_contiguous_and_cannot_inject_timestamps(self):
        result = helper._build_srt([(0, 1, " "), (1, 2, " Hello\n\nworld "), (3, 3, "empty duration")])
        self.assertEqual(result, "1\n00:00:01,000 --> 00:00:02,000\nHello world\n")
        self.assertEqual(helper._build_srt([]), "")

    def test_shared_asr_runs_once_and_keeps_auto_language(self):
        calls = []

        class Model:
            def __init__(self, *_args, **_kwargs):
                pass

            def transcribe(self, audio, **kwargs):
                calls.append(kwargs)
                return iter([types.SimpleNamespace(start=0.0, end=2.5, text=" Hello")]), types.SimpleNamespace(language="en")

        with tempfile.NamedTemporaryFile() as audio, patch.dict(sys.modules, {"faster_whisper": types.SimpleNamespace(WhisperModel=Model)}):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = helper.main(["--audio", audio.name, "--format", "srt"])
            result = json.loads(out.getvalue())
            self.assertEqual(code, 0)
            self.assertEqual(result["language"], "en")
            self.assertEqual(result["text"], "Hello")
            self.assertEqual(result["srt"], "1\n00:00:00,000 --> 00:00:02,500\nHello\n")
            self.assertEqual(len(calls), 1)
            self.assertIsNone(calls[0]["language"])

    def test_unsupported_engine_is_an_error_before_loading_dependencies(self):
        with tempfile.NamedTemporaryFile() as audio:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = helper.main(["--audio", audio.name, "--format", "srt", "--engine", "sensevoice"])
            self.assertEqual(code, 2)
            self.assertIn("error", json.loads(out.getvalue()))


if __name__ == "__main__":
    unittest.main()
