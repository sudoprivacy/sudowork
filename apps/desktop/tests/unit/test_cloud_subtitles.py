"""Cloud subtitle safety and failure behavior without model downloads."""

import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

MODULE = Path(__file__).resolve().parents[2] / "skills/_builtin/video-subtitles/scripts/cloud_media.py"
spec = importlib.util.spec_from_file_location("cloud_media", MODULE)
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class CloudSubtitleTests(unittest.TestCase):
    def test_timed_cues_skip_empty_and_collapsed_segments(self):
        segments = [
            SimpleNamespace(start=0.0, end=1.2, text=" Hello\nworld "),
            SimpleNamespace(start=1.2, end=1.2, text="bad"),
            SimpleNamespace(start=1.2, end=2.0, text=" "),
            SimpleNamespace(start=2.01, end=3.5, text="再见"),
        ]
        self.assertEqual(media.build_srt(segments), "1\n00:00:00,000 --> 00:00:01,200\nHello world\n\n2\n00:00:02,010 --> 00:00:03,500\n再见\n")

    def test_silence_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "No speech"):
            media.build_srt([])

    def test_invalid_timestamps_are_rejected(self):
        with self.assertRaises(ValueError):
            media.timestamp(float("nan"))

    def test_publish_never_overwrites(self):
        with tempfile.TemporaryDirectory() as root:
            source, target = Path(root) / "stage.mp4", Path(root) / "video.mp4"
            source.write_bytes(b"new video")
            target.write_bytes(b"original")
            with self.assertRaises(FileExistsError):
                media.publish(source, target)
            self.assertEqual(target.read_bytes(), b"original")

    def test_staging_cleanup_keeps_published_video(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "video.mp4"
            with tempfile.TemporaryDirectory(dir=root) as stage:
                source = Path(stage) / "video.mp4"
                source.write_bytes(b"finished")
                media.publish(source, target)
            self.assertEqual(target.read_bytes(), b"finished")

    def test_invalid_subtitles_do_not_leave_an_output(self):
        with tempfile.TemporaryDirectory() as root:
            source, captions, target = [Path(root) / name for name in ["original.mp4", "empty.srt", "new.mp4"]]
            source.write_bytes(b"preserve me")
            captions.touch()
            args = SimpleNamespace(command="burn", input=str(source), output=str(target), subtitles=str(captions), model=None, language=None)
            with self.assertRaisesRegex(ValueError, "nonempty"):
                media.run(args)
            self.assertFalse(target.exists())
            self.assertEqual(source.read_bytes(), b"preserve me")
            self.assertFalse(list(Path(root).glob(".subtitles-*")))


if __name__ == "__main__":
    unittest.main()
