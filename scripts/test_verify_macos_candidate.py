import importlib.util
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('verify_macos_candidate', Path(__file__).with_name('verify_macos_candidate.py'))
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class MacOSCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.make_app(self.root)
        self.signature = ('Identifier=com.sudowork.app\nAuthority=Developer ID Application: Example\n'
                          'TeamIdentifier=AB12345678\nCodeDirectory v=20500 size=123 flags=0x10000(runtime)\nCDHash=abc123\n')

    def make_app(self, root):
        app = root / 'Sudowork.app'
        (app / 'Contents').mkdir(parents=True)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': 'com.sudowork.app', 'CFBundleExecutable': 'Sudowork',
            'CFBundleShortVersionString': '1.0', 'CFBundleVersion': '1'}))
        return app

    def verify_app(self):
        return candidate.verify_app(self.app, 'AB12345678', 'com.sudowork.app', 'arm64')

    def test_rejects_adhoc_wrong_team_wrong_identity_and_missing_hardening(self):
        for signature in (self.signature.replace('Authority=Developer ID Application: Example', 'Signature=adhoc'),
                          self.signature.replace('AB12345678', 'XY12345678'),
                          self.signature.replace('Identifier=com.sudowork.app', 'Identifier=com.other.app'),
                          self.signature.replace('flags=0x10000(runtime)', 'flags=0x0(none)')):
            with self.subTest(signature=signature), patch.object(candidate, 'run', return_value=b'arm64'), \
                    patch.object(candidate.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'', signature.encode())):
                with self.assertRaisesRegex(ValueError, 'Expected Developer ID'):
                    self.verify_app()

    def test_signature_ticket_and_gatekeeper_each_must_pass(self):
        for failure in ('codesign', 'xcrun', 'spctl'):
            def run(*args):
                if args[0] == failure:
                    raise subprocess.CalledProcessError(1, args)
                return b'arm64'
            with self.subTest(failure=failure), patch.object(candidate, 'run', side_effect=run), \
                    patch.object(candidate.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'', self.signature.encode())):
                with self.assertRaises(subprocess.CalledProcessError):
                    self.verify_app()
        with patch.object(candidate, 'run', return_value=b'x86_64'):
            with self.assertRaisesRegex(ValueError, 'architecture'):
                self.verify_app()

    def test_distribution_parity_receipt_and_mount_cleanup(self):
        (self.root / 'Sudowork.dmg').write_bytes(b'dmg bytes')
        (self.root / 'Sudowork-mac-arm64.zip').write_bytes(b'zip bytes')
        calls = []

        def run(*args):
            calls.append(args)
            if args[:2] == ('hdiutil', 'attach'):
                self.make_app(Path(args[6]))
            if args[0] == 'ditto':
                self.make_app(Path(args[-1]))
            return b''

        def verify():
            return candidate.verify(self.root, 'AB12345678', 'com.sudowork.app', 'arm64', 'a' * 40)

        with patch.object(candidate, 'run', side_effect=run), patch.object(candidate, 'verify_app', return_value={'cdhash': 'abc'}):
            result = verify()
            self.assertEqual(len(result['artifacts']), 2)
            self.assertTrue((self.root / 'macos-candidate.json').exists())
        with patch.object(candidate, 'run', side_effect=run), patch.object(candidate, 'verify_app', side_effect=[{'cdhash': 'abc'}, {'cdhash': 'def'}]):
            with self.assertRaisesRegex(ValueError, 'different signed applications'):
                verify()
            self.assertFalse((self.root / 'macos-candidate.json').exists())
        calls.clear()
        with patch.object(candidate, 'run', side_effect=run), patch.object(candidate, 'verify_app', side_effect=ValueError('bad ticket')):
            with self.assertRaisesRegex(ValueError, 'bad ticket'):
                verify()
            self.assertEqual(calls[-1][:2], ('hdiutil', 'detach'))
        (self.root / 'extra.dmg').write_bytes(b'old dmg')
        with self.assertRaisesRegex(ValueError, 'exactly one DMG'):
            verify()


if __name__ == '__main__':
    unittest.main()
