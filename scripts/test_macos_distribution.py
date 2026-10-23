from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import macos_distribution as distribution
import smoke_install_macos as smoke


class MacOSDistributionTests(unittest.TestCase):
    def test_readonly_mount_uses_forced_detach_only_for_resource_busy(self):
        with tempfile.TemporaryDirectory() as temporary:
            mount = Path(temporary) / 'mount'
            calls = []

            def run(*args):
                calls.append(args)
                if args[:2] == ('hdiutil', 'detach') and '-force' not in args:
                    raise subprocess.CalledProcessError(16, args)

            with distribution.mounted_dmg(Path('candidate.dmg'), mount, runner=run):
                self.assertTrue(mount.is_dir())
            self.assertIn('-readonly', calls[0])
            self.assertEqual(calls[-1], ('hdiutil', 'detach', '-force', str(mount)))

    def test_other_detach_errors_and_failed_force_remain_failures(self):
        for failures in ([5], [16, 5]):
            with self.subTest(failures=failures), tempfile.TemporaryDirectory() as temporary:
                observed = []
                pending = iter(failures)

                def run(*args):
                    if args[:2] == ('hdiutil', 'detach'):
                        observed.append(args)
                        raise subprocess.CalledProcessError(next(pending), args)

                with self.assertRaises(subprocess.CalledProcessError):
                    with distribution.mounted_dmg(Path('candidate.dmg'), Path(temporary) / 'mount', runner=run):
                        pass
                self.assertEqual(len(observed), len(failures))

    def test_body_failure_detaches_the_owned_mount(self):
        with tempfile.TemporaryDirectory() as temporary:
            calls = []
            with self.assertRaisesRegex(ValueError, 'copy failed'):
                with distribution.mounted_dmg(Path('candidate.dmg'), Path(temporary) / 'mount', runner=lambda *args: calls.append(args)):
                    raise ValueError('copy failed')
            self.assertEqual(calls[-1][:2], ('hdiutil', 'detach'))

    def test_install_executes_the_copied_app_after_unmount_and_propagates_launch_failure(self):
        for is_failed in (False, True):
            with self.subTest(is_failed=is_failed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / 'candidate.dmg').write_bytes(b'fixture')
                calls = []
                installed_binary = []

                def run(*args):
                    calls.append(args)
                    if args[:2] == ('hdiutil', 'attach'):
                        contents = Path(args[6]) / 'Sudowork.app/Contents'
                        (contents / 'MacOS').mkdir(parents=True)
                        (contents / 'Info.plist').write_bytes(plistlib.dumps({
                            'CFBundleExecutable': 'Sudowork', 'CFBundleShortVersionString': '1.0'}))
                        binary = contents / 'MacOS/Sudowork'
                        binary.write_text('fixture')
                        binary.chmod(0o755)
                    elif args[0] == 'ditto':
                        shutil.copytree(args[1], args[2])
                    elif args[-1] == '--version':
                        self.assertEqual(calls[-2][:2], ('hdiutil', 'detach'))
                        installed_binary.append(Path(args[0]))
                        self.assertIn('installed', installed_binary[-1].parts)
                        if is_failed:
                            raise subprocess.CalledProcessError(7, args)

                with patch.object(smoke, 'run', side_effect=run):
                    if is_failed:
                        with self.assertRaises(subprocess.CalledProcessError):
                            smoke.verify_install(root)
                    else:
                        self.assertEqual(smoke.verify_install(root), {'installed_and_executed': True, 'version': '1.0'})
                self.assertEqual(len(installed_binary), 1)
                self.assertFalse(installed_binary[0].exists())


if __name__ == '__main__':
    unittest.main()
