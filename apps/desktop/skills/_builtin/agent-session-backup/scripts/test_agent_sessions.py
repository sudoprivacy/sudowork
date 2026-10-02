import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import agent_sessions as backup


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'
        self.sessions = self.home / '.codex/sessions/2026/10/03'
        self.sessions.mkdir(parents=True)
        self.file = self.sessions / 'rollout-test.jsonl'
        rows = [{'type': 'session_meta', 'payload': {'id': 'sid', 'cwd': '/work/project', 'cli_version': '0.160.0'}},
                {'type': 'response_item', 'payload': {'role': 'user', 'content': [{'type': 'input_text', 'text': 'My private task'}]}}]
        self.file.write_text(''.join(json.dumps(x) + '\n' for x in rows) + '42\nnull\n{"incomplete":', encoding='utf-8')
        (self.home / '.codex/auth.json').write_text('secret')
        self.db = sqlite3.connect(self.home / '.codex/state_5.sqlite')
        self.db.execute('pragma journal_mode=wal')
        self.db.execute('create table messages (body text)')
        self.db.execute("insert into messages values ('committed in WAL')")
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def export(self):
        path = self.root / 'snapshot.zip'
        result = backup.export_archive(argparse.Namespace(output=str(path), home=str(self.home), engine=['codex'], project=None, name='My agent'))
        return path, result

    def test_round_trip_preserves_wal_and_readable_context_without_credentials(self):
        path, result = self.export()
        self.assertEqual(result['sessionRecords'], 1)
        dest = self.root / 'restored'
        backup.restore(argparse.Namespace(archive=str(path), destination=str(dest)))
        self.assertFalse((dest / 'native/codex/auth.json').exists())
        index = json.loads((dest / 'sessions.json').read_text())
        self.assertEqual(index[0]['sessionId'], 'sid')
        self.assertEqual(index[0]['cwd'], '/work/project')
        self.assertIn('My private task', (dest / index[0]['readablePath']).read_text())
        raw = (dest / index[0]['path']).read_text()
        self.assertNotIn('incomplete', raw)
        self.assertIn('incomplete', self.file.read_text())
        db = sqlite3.connect(dest / 'native/codex/state_5.sqlite')
        try:
            self.assertEqual(db.execute('select body from messages').fetchone()[0], 'committed in WAL')
        finally:
            db.close()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            backup.restore(argparse.Namespace(archive=str(path), destination=str(dest)))

    def test_modified_member_rejected(self):
        path, _ = self.export()
        bad = self.root / 'bad.zip'
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(bad, 'w') as target:
            for name in source.namelist():
                target.writestr(name, b'corrupt' if name == 'START_HERE.md' else source.read(name))
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            backup.verify_archive(bad)

    def test_claude_project_filter_preserves_memory_and_rejects_no_match(self):
        project = self.home / '.claude/projects/project-one'
        project.mkdir(parents=True)
        (project / 'one.jsonl').write_text(json.dumps({'sessionId': 'cc-one', 'cwd': '/work/one'}) + '\n')
        (project / 'memory').mkdir()
        (project / 'memory/MEMORY.md').write_text('Project decisions')
        rows = backup.sources(self.home, ['claude-code'], ['/work/one'])
        self.assertEqual(len(rows), 2)
        self.assertTrue(any(name.endswith('memory/MEMORY.md') for _, _, name in rows))
        with self.assertRaisesRegex(ValueError, 'No Claude Code sessions'):
            backup.sources(self.home, ['claude-code'], ['/work/missing'])

    def test_sudocode_preserves_workspace_sessions_and_user_memory(self):
        project = self.root / 'work'
        session = project / '.scode/sessions/session-one'
        session.mkdir(parents=True)
        (session / 'messages.jsonl').write_text('{"role":"user","content":"Continue my work"}\n')
        memory = self.home / '.scode/projects/work'
        memory.mkdir(parents=True)
        (memory / 'MEMORY.md').write_text('Private decisions')
        rows = backup.sources(self.home, ['sudocode'], [str(project)])
        self.assertEqual(len(rows), 2)
        self.assertTrue(any('/.scode/sessions/session-one/messages.jsonl' in name for _, _, name in rows))
        self.assertTrue(any(name == 'native/sudocode/projects/work/MEMORY.md' for _, _, name in rows))

    def test_traversal_rejected_before_extraction(self):
        bad = self.root / 'traversal.zip'
        with zipfile.ZipFile(bad, 'w') as archive:
            archive.writestr('../escape', 'payload')
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            backup.verify_archive(bad)

    def test_existing_output_not_overwritten(self):
        self.export()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.export()

    def test_download_resumes_only_a_verified_prefix(self):
        path, _ = self.export()
        raw = path.read_bytes()
        item = {'agentName': 'agent', 'sha256': hashlib.sha256(raw).hexdigest(), 'size': len(raw), 'chunkBytes': 100, 'status': 'ready'}
        calls = []
        is_interrupted = True
        class MockCloud:
            def __init__(self, _config): pass
            def request(self, method, suffix=''):
                nonlocal is_interrupted
                if suffix == '/agent': return item
                index = int(suffix.rsplit('/', 1)[1])
                calls.append(index)
                if index == 1 and is_interrupted:
                    is_interrupted = False
                    raise ValueError('network interrupted')
                return raw[index * 100:(index + 1) * 100]
        args = argparse.Namespace(config=None, agent='agent', output=str(self.root / 'download.zip'))
        with patch.object(backup, 'Cloud', MockCloud):
            with self.assertRaisesRegex(ValueError, 'interrupted'):
                backup.download(args)
            calls.clear()
            self.assertTrue(backup.download(args)['verified'])
            self.assertNotIn(0, calls)
            self.assertEqual(Path(args.output).read_bytes(), raw)

    def test_portable_archive_rejects_case_collisions(self):
        bad = self.root / 'collision.zip'
        with zipfile.ZipFile(bad, 'w') as archive:
            archive.writestr('A.txt', 'a')
            archive.writestr('a.txt', 'b')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            backup.verify_archive(bad)


if __name__ == '__main__':
    unittest.main()
