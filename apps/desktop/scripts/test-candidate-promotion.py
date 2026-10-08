"""Exercise candidate promotion against isolated local Git remotes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class CandidatePromotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sudowork-candidate-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'work'
        self.repo.mkdir()
        self.remote = self.root / 'remote.git'
        self.env = os.environ.copy()
        self.env['GIT_CONFIG_NOSYSTEM'] = '1'
        self.env['GIT_CONFIG_GLOBAL'] = os.devnull
        if os.name == 'nt':
            self.env['PATH'] = r'D:\Program Files\nodejs;C:\Program Files\Git\cmd;' + self.env['PATH']
        self.git('init', '--bare', str(self.remote))
        self.git('init')
        self.git('config', 'user.name', 'Release Test')
        self.git('config', 'user.email', 'release-test@example.invalid')
        self.write_versions('0.2.27')
        self.commit('base')
        self.git('branch', '-M', 'main')
        self.base = self.git('rev-parse', 'HEAD')
        self.git('remote', 'add', 'origin', str(self.remote))
        self.git('push', '-u', 'origin', 'main')
        self.write_versions('0.2.28')
        self.commit('candidate')
        self.candidate = self.git('rev-parse', 'HEAD')
        self.tag = 'nightly-2026-10-09-' + self.candidate[:7]
        self.git('tag', self.tag)
        self.git('branch', 'dev')
        self.git('push', 'origin', 'dev', '--tags')

    def git(self, *args):
        result = subprocess.run(['git', *args], cwd=self.repo, env=self.env,
                                capture_output=True, text=True, encoding='utf-8', timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def write_versions(self, version):
        for relative in ['package.json', 'apps/desktop/package.json']:
            path = self.repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({'version': version}), encoding='utf-8')

    def commit(self, message):
        self.git('add', '.')
        self.git('commit', '-m', message)

    def run_phase(self, mode, version='0.2.28', expected=None, tag=None):
        bash = r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else shutil.which('bash')
        script = Path(__file__).with_name('promote-candidate.sh').resolve()
        args = [bash, script.as_posix(), mode, tag or self.tag, version]
        if expected is not None:
            args.append(expected)
        return subprocess.run(args, cwd=self.repo, env=self.env,
                              capture_output=True, text=True, encoding='utf-8', timeout=30)

    def remote_ref(self, ref):
        return self.git('--git-dir=' + str(self.remote), 'rev-parse', ref)

    def test_validate_records_the_candidate_sha(self):
        result = self.run_phase('validate')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), self.candidate)

    def test_newer_dev_is_not_promoted(self):
        self.git('switch', 'dev')
        (self.repo / 'unaudited.txt').write_text('later dev change', encoding='utf-8')
        self.commit('later dev')
        self.git('push', 'origin', 'dev')
        for phase in ['rc', 'promote']:
            result = self.run_phase(phase, expected=self.candidate)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.remote_ref('refs/heads/main'), self.candidate)
        for tag in ['v0.2.28-rc', 'v0.2.28']:
            self.assertEqual(self.remote_ref('refs/tags/' + tag), self.candidate)

    def test_target_version_must_match_the_candidate(self):
        self.assertNotEqual(self.run_phase('rc', version='0.2.29', expected=self.candidate).returncode, 0)
        self.assertEqual(self.remote_ref('refs/heads/main'), self.base)

    def test_both_manifests_must_match(self):
        (self.repo / 'apps/desktop/package.json').write_text('{"version":"0.2.29"}', encoding='utf-8')
        self.commit('mismatched manifest')
        self.git('tag', '-f', self.tag)
        self.assertNotEqual(self.run_phase('validate').returncode, 0)

    def test_changed_nightly_tag_is_rejected(self):
        (self.repo / 'changed.txt').write_text('different candidate', encoding='utf-8')
        self.commit('changed candidate')
        self.git('tag', '-f', self.tag)
        self.assertNotEqual(self.run_phase('rc', expected=self.candidate).returncode, 0)

    def test_main_advanced_after_audit_stops_publication(self):
        self.assertEqual(self.run_phase('rc', expected=self.candidate).returncode, 0)
        (self.repo / 'changed.txt').write_text('new main change', encoding='utf-8')
        self.commit('new main')
        changed = self.git('rev-parse', 'HEAD')
        self.git('push', 'origin', 'HEAD:refs/heads/main')
        self.assertNotEqual(self.run_phase('promote', expected=self.candidate).returncode, 0)
        self.assertEqual(self.remote_ref('refs/heads/main'), changed)

    def test_wrong_rc_commit_stops_publication(self):
        self.git('tag', 'v0.2.28-rc', self.base)
        self.assertNotEqual(self.run_phase('promote', expected=self.candidate).returncode, 0)
        self.assertEqual(self.remote_ref('refs/heads/main'), self.base)

    def test_existing_stable_tag_stops_publication(self):
        self.git('tag', 'v0.2.28', self.base)
        self.assertNotEqual(self.run_phase('rc', expected=self.candidate).returncode, 0)

    def test_remote_tag_collision_does_not_partially_update_main(self):
        self.assertEqual(self.run_phase('rc', expected=self.candidate).returncode, 0)
        self.git('--git-dir=' + str(self.remote), 'update-ref', 'refs/tags/v0.2.28', self.base)
        self.assertNotEqual(self.run_phase('promote', expected=self.candidate).returncode, 0)
        self.assertEqual(self.remote_ref('refs/heads/main'), self.base)
        self.assertEqual(self.remote_ref('refs/tags/v0.2.28'), self.base)

    def test_dirty_checkout_cannot_create_rc(self):
        (self.repo / 'uncommitted.txt').write_text('local change', encoding='utf-8')
        self.assertNotEqual(self.run_phase('rc', expected=self.candidate).returncode, 0)
        self.assertEqual(self.remote_ref('refs/heads/main'), self.base)

    def test_invalid_inputs_do_not_execute_shell_text(self):
        self.assertNotEqual(self.run_phase('validate', tag='nightly-2026-10-09-$(touch injected)').returncode, 0)
        self.assertNotEqual(self.run_phase('validate', version='0.2.28;touch injected').returncode, 0)
        self.assertFalse((self.repo / 'injected').exists())


if __name__ == '__main__':
    unittest.main()
