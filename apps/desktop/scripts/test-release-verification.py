"""Exercise release metadata validation with small, local artifacts."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class ReleaseVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.assets = self.root / 'assets'
        self.assets.mkdir()
        self.binary = self.assets / 'Sudowork-0.2.21-win-x64.exe'
        self.binary.write_bytes(b'fixture for release validation')
        digest = base64.b64encode(hashlib.sha512(self.binary.read_bytes()).digest()).decode()
        (self.assets / 'latest.yml').write_text(
            f'version: 0.2.21\nfiles:\n  - url: {self.binary.name}\n'
            f'    sha512: {digest}\n    size: {self.binary.stat().st_size}\n'
            f'path: {self.binary.name}\nsha512: {digest}\n', encoding='utf-8')
        with gzip.open(str(self.binary) + '.blockmap', 'wt', encoding='utf-8') as output:
            json.dump({'version': '2', 'files': []}, output)
        self.env = os.environ.copy()
        if os.name == 'nt':
            shim = self.root / 'bin'
            shim.mkdir()
            (shim / 'python3').write_text(
                '#!/usr/bin/env bash\nexec "' + Path(sys.executable).as_posix() + '" "$@"\n',
                encoding='utf-8', newline='\n')
            self.env['PATH'] = str(shim) + os.pathsep + self.env['PATH']

    def run_verifier(self, mode='--windows-only'):
        bash = r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else shutil.which('bash')
        script = Path(__file__).with_name('verify-release-assets.sh')
        return subprocess.run([bash, script.as_posix(), self.assets.as_posix(), mode],
                              capture_output=True, text=True, env=self.env)

    def test_valid_windows_release_can_publish_independently(self):
        result = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_full_release_still_requires_both_macos_feeds(self):
        result = self.run_verifier('--all')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing required metadata: latest-mac.yml', result.stdout)

    def test_windows_mode_rejects_other_platform_assets(self):
        (self.assets / 'Sudowork-0.2.21-mac-x64.dmg').write_bytes(b'other platform')
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('contains other assets', result.stderr)

    def test_tampered_artifact_is_rejected(self):
        self.binary.write_bytes(b'tampered')
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SHA-512 mismatch', result.stdout)

    def test_missing_blockmap_is_rejected(self):
        Path(str(self.binary) + '.blockmap').unlink()
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing blockmap', result.stdout)

    def test_unknown_mode_is_rejected(self):
        self.assertNotEqual(self.run_verifier('--skip-validation').returncode, 0)


if __name__ == '__main__':
    unittest.main()
