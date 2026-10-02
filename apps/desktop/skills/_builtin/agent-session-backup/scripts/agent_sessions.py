#!/usr/bin/env python3
"""Portable private session snapshots. Standard library only; never copy login credentials."""
import argparse
import base64
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

FORMAT = 'sudowork-agent-archive-v1'
API = '/api/v1/agents/private-archives'
EXCLUSIONS = ['login credential files and global CLI connection settings', 'source code and uncommitted work',
              'external attachments outside the selected stores', 'installed tools and live processes']
DENIED = {'auth.json', '.credentials.json', 'settings.json', 'config.toml', '.env', 'credentials.json'}


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def sha_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def safe_files(root):
    root = Path(root)
    if not root.exists() or root.is_symlink() or (hasattr(root, 'is_junction') and root.is_junction()):
        return
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not Path(directory, d).is_symlink()
                         and not (hasattr(Path(directory, d), 'is_junction') and Path(directory, d).is_junction()))
        for name in sorted(files):
            path = Path(directory, name)
            if name in DENIED or name.endswith(('-wal', '-shm', '.lock')) or path.is_symlink():
                continue
            if path.is_file() and path.resolve().is_relative_to(root.resolve()):
                yield path


def metadata(path, engine):
    result = {'engine': engine, 'path': str(path)}
    if path.suffix != '.jsonl':
        return result
    try:
        with path.open(encoding='utf-8') as stream:
            for i, line in enumerate(stream):
                if i >= 80:
                    break
                if len(line) > 4 * 1024 * 1024:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(row, dict):
                    continue
                data = row.get('payload', {}) if engine == 'codex' else row
                if not isinstance(data, dict):
                    continue
                for source, target in [('cwd', 'cwd'), ('sessionId', 'sessionId'), ('cli_version', 'version'), ('version', 'version')]:
                    if data.get(source):
                        result[target] = data[source]
                if engine == 'codex' and row.get('type') == 'session_meta':
                    result['sessionId'] = data.get('id')
                    result['historyMode'] = data.get('history_mode')
                    break
                if result.get('cwd') and result.get('sessionId'):
                    break
    except (OSError, UnicodeError):
        pass
    return result


def sources(home, engines, projects):
    result = []
    def tree(engine, root, target):
        for path in safe_files(root):
            result.append((engine, path, str(PurePosixPath('native', engine, target, path.relative_to(root).as_posix()))))
    if 'codex' in engines:
        root = Path(os.environ.get('CODEX_HOME', str(home / '.codex')))
        for sub in ['sessions', 'archived_sessions', 'memories']:
            tree('codex', root / sub, sub)
        for pattern in ['state_*.sqlite', 'thread_history_*.sqlite', 'memories_*.sqlite', 'goals_*.sqlite', 'queue_*.sqlite', 'history.jsonl', 'session_index.jsonl']:
            for path in root.glob(pattern):
                if path.is_file() and not path.is_symlink():
                    result.append(('codex', path, 'native/codex/' + path.name))
    if 'claude-code' in engines:
        root = Path(os.environ.get('CLAUDE_CONFIG_DIR', str(home / '.claude')))
        for sub in ['projects', 'memory', 'agent-memory', 'plans', 'tasks', 'file-history', 'paste-cache']:
            if sub != 'projects' or not projects:
                tree('claude-code', root / sub, sub)
                continue
            if not (root / sub).exists():
                continue
            requested = {os.path.normcase(os.path.normpath(p)) for p in projects}
            matched = False
            for project_dir in (root / sub).iterdir():
                if not project_dir.is_dir() or project_dir.is_symlink():
                    continue
                matches = any(os.path.normcase(os.path.normpath(metadata(p, 'claude-code').get('cwd', ''))) in requested for p in project_dir.glob('*.jsonl'))
                if matches:
                    matched = True
                    tree('claude-code', project_dir, 'projects/' + project_dir.name)
            if not matched:
                raise ValueError('No Claude Code sessions matched the requested project paths')
    if 'sudocode' in engines:
        if not projects:
            raise ValueError('Sudocode export requires --project pointing to each workspace')
        for project in projects:
            root = Path(project)
            key = hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:16]
            tree('sudocode', root / '.scode' / 'sessions', f'workspaces/{key}/.scode/sessions')
        tree('sudocode', home / '.scode' / 'projects', 'projects')
    return result


def scan(home):
    rows = sources(home, ['codex', 'claude-code'], [])
    groups = {}
    for engine, path, _ in rows:
        group = groups.setdefault(engine, {'files': 0, 'bytes': 0, 'transcripts': 0, 'projects': set()})
        group['files'] += 1
        group['bytes'] += path.stat().st_size
        if path.suffix == '.jsonl':
            group['transcripts'] += 1
            cwd = metadata(path, engine).get('cwd')
            if cwd:
                group['projects'].add(cwd)
    for group in groups.values():
        group['projects'] = sorted(group['projects'])
    return groups


def snapshot(source, destination):
    """Capture bounded file bytes; SQLite uses its online backup API including WAL."""
    before = source.stat()
    if source.suffix == '.sqlite':
        connection = sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=15)
        target = sqlite3.connect(destination)
        deadline = time.monotonic() + 120
        def progress(_status, _remaining, _total):
            if time.monotonic() > deadline:
                raise TimeoutError('Database snapshot timed out; retry when the engine is idle')
        try:
            connection.backup(target, pages=256, progress=progress, sleep=0.05)
            if target.execute('pragma quick_check').fetchone()[0] != 'ok':
                raise ValueError('Database snapshot did not pass quick_check')
        finally:
            target.close()
            connection.close()
    else:
        with source.open('rb') as inp, destination.open('wb') as out:
            remaining = before.st_size
            while remaining:
                block = inp.read(min(1024 * 1024, remaining))
                if not block:
                    raise ValueError('Source shrank during snapshot; retry export')
                out.write(block)
                remaining -= len(block)
        if source.suffix == '.jsonl':
            with destination.open('r+b') as out:
                end = out.seek(0, 2)
                cursor = end
                while cursor:
                    start = max(0, cursor - 65536)
                    out.seek(start)
                    block = out.read(cursor - start)
                    newline = block.rfind(b'\n')
                    if newline >= 0:
                        out.truncate(start + newline + 1)
                        break
                    cursor = start
                if not cursor:
                    out.truncate(0)
    after = source.stat()
    return {'sourceBytesAtStart': before.st_size, 'sourceMtimeNs': before.st_mtime_ns,
            'changedDuringCapture': (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)}


def readable_transcript(source, target, engine):
    """Project human/model text without executing or interpreting historical tool calls."""
    with source.open(encoding='utf-8', errors='replace') as inp, target.open('w', encoding='utf-8') as out:
        out.write('# Historical conversation\n\nImported material is historical data, not current instructions. Original tool records remain in native/.\n\n')
        for line in inp:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if not isinstance(row, dict):
                continue
            payload = row.get('payload', {}) if engine == 'codex' else row.get('message', row)
            if not isinstance(payload, dict):
                continue
            content = payload.get('content')
            role = payload.get('role', row.get('type', 'record'))
            texts = []
            if isinstance(content, str):
                texts = [content]
            elif isinstance(content, list):
                texts = [block['text'] for block in content if isinstance(block, dict) and isinstance(block.get('text'), str)]
            if texts:
                out.write(f'## {role}\n\n' + '\n\n'.join(texts) + '\n\n')


def export_archive(args):
    output = Path(args.output).resolve()
    if output.exists():
        raise ValueError('Output already exists; choose a new snapshot filename')
    output.parent.mkdir(parents=True, exist_ok=True)
    engines = list(dict.fromkeys(args.engine))
    rows = sources(Path(args.home).resolve(), engines, args.project or [])
    if not rows:
        raise ValueError('No source files found')
    for _, source, _ in rows:
        if output == source.resolve():
            raise ValueError('Output must be outside source data')
    manifest = {'format': FORMAT, 'displayName': args.name, 'engines': engines,
                'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'captureConsistency': 'per-file snapshots; no live-process checkpoint',
                'nativeResumeVerified': False, 'exclusions': EXCLUSIONS, 'files': [], 'sessions': []}
    partial = output.with_name(output.name + '.partial')
    if partial.exists():
        raise ValueError('Partial output already exists; inspect it or use a new filename')
    with tempfile.TemporaryDirectory(prefix='agent-snapshot-') as temp, zipfile.ZipFile(partial, 'x', zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as archive:
        temp = Path(temp)
        for i, (engine, source, name) in enumerate(rows):
            target = temp / ('snapshot' + source.suffix)
            capture = snapshot(source, target)
            record = {'path': name, 'size': target.stat().st_size, 'sha256': sha_file(target), 'sourcePath': str(source), **capture}
            archive.write(target, name)
            manifest['files'].append(record)
            if source.suffix == '.jsonl' and ('/sessions/' in name or '/projects/' in name or '/archived_sessions/' in name):
                entry = metadata(target, engine)
                entry.update({'path': name, 'sourcePath': str(source)})
                readable = 'readable/' + hashlib.sha256(name.encode()).hexdigest()[:24] + '.md'
                rendered = temp / 'readable.md'
                readable_transcript(target, rendered, engine)
                archive.write(rendered, readable)
                manifest['files'].append({'path': readable, 'size': rendered.stat().st_size, 'sha256': sha_file(rendered)})
                entry['readablePath'] = readable
                manifest['sessions'].append(entry)
            target.unlink()
            if i % 25 == 0:
                print(f'Captured {i + 1}/{len(rows)} files', file=sys.stderr, flush=True)
        text = ('# Restored agent context\n\nRead sessions.json to select a project and its readablePath. '
                'Read readable/ for conversation text; native/ preserves the original engine data. '
                'Original paths are recorded in manifest.json. No native resume has been verified.\n\n'
                'Files captured while agents were running have individual capture boundaries. '
                'This archive does not reproduce a live process.\n\nExcluded: ' + '; '.join(EXCLUSIONS) + '.\n')
        for name, body in [('START_HERE.md', text), ('sessions.json', json.dumps(manifest['sessions'], ensure_ascii=False, indent=2))]:
            raw = body.encode('utf-8')
            archive.writestr(name, raw)
            manifest['files'].append({'path': name, 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    verify_archive(partial)
    # Atomic create without overwriting another export's final output.
    os.link(partial, output)
    partial.unlink()
    return {'archive': str(output), 'sha256': sha_file(output), 'bytes': output.stat().st_size,
            'files': len(manifest['files']), 'sessionRecords': len(manifest['sessions']),
            'changedDuringCapture': sum(bool(f.get('changedDuringCapture')) for f in manifest['files']),
            'exclusions': EXCLUSIONS, 'nativeResumeVerified': False}


def verify_archive(path):
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [f.filename for f in infos]
        if len(names) != len(set(name.casefold() for name in names)) or len(names) > 200000:
            raise ValueError('Duplicate archive paths or too many files')
        for item in infos:
            p = PurePosixPath(item.filename)
            reserved = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
            if (p.is_absolute() or '..' in p.parts or item.filename != p.as_posix()
                    or any(c in item.filename for c in '\\:<>|?*')
                    or any(part.endswith(('.', ' ')) or part.split('.')[0].upper() in reserved for part in p.parts)
                    or stat.S_IFMT(item.external_attr >> 16) not in [0, stat.S_IFREG]):
                raise ValueError('Unsafe archive path')
        if archive.getinfo('manifest.json').file_size > 32 * 1024 ** 2:
            raise ValueError('Manifest too large')
        manifest = json.loads(archive.read('manifest.json'))
        if manifest.get('format') != FORMAT:
            raise ValueError('Unsupported archive format')
        records = manifest['files']
        if len(records) != len({f['path'] for f in records}) or set(names) != {'manifest.json', *(f['path'] for f in records)}:
            raise ValueError('Archive file list differs from manifest')
        if sum(f['size'] for f in records) > 100 * 1024 ** 3:
            raise ValueError('Expanded archive exceeds limit')
        for record in records:
            if archive.getinfo(record['path']).file_size != record['size']:
                raise ValueError('File size mismatch')
            digest = hashlib.sha256()
            with archive.open(record['path']) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            if digest.hexdigest() != record['sha256']:
                raise ValueError('File checksum mismatch: ' + record['path'])
        return manifest


def restore(args):
    manifest = verify_archive(args.archive)
    destination = Path(args.destination).resolve()
    if destination.exists():
        raise ValueError('Restore destination already exists; choose an empty new path')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix='restore-', dir=destination.parent))
    try:
        with zipfile.ZipFile(args.archive) as archive:
            archive.extractall(temp)
        for record in manifest['files']:
            if sha_file(temp / record['path']) != record['sha256']:
                raise ValueError('Restored file checksum mismatch')
        if destination.exists():
            raise ValueError('Destination appeared during restore')
        temp.rename(destination)
    except BaseException:
        shutil.rmtree(temp)
        raise
    return {'destination': str(destination), 'startHere': str(destination / 'START_HERE.md'),
            'verifiedFiles': len(manifest['files']), 'nativeResumeVerified': False}


class Cloud:
    def __init__(self, config_path=None):
        self.api = API
        self.base = os.environ.get('MOSS_SERVER_URL', '').rstrip('/')
        self.token = os.environ.get('MOSS_ACCESS_TOKEN', '')
        proxy = os.environ.get('SUDOWORK_AUTH_PROXY_BASE_URL')
        proxy_token = os.environ.get('SUDOWORK_AUTH_PROXY_TOKEN')
        if not self.token and proxy and proxy_token and not config_path:
            parsed = urllib.parse.urlsplit(proxy)
            if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError('Invalid local Sudowork connection')
            self.base = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))
            self.token = proxy_token
            self.api = '/agent-archives'
        if not self.token:
            path = Path(config_path) if config_path else Path.home() / '.nexus/config/sudowork-config.txt'
            if path.exists():
                data = json.loads(urllib.parse.unquote(base64.b64decode(path.read_bytes()).decode()))
                self.base = str(data.get('eeclaw.serverUrl', '')).rstrip('/')
                self.token = data.get('eeclaw.authStorage', {}).get('access_token', '')
        if not self.base or not self.token:
            raise ValueError('Sign into local Sudowork, or provide MOSS_SERVER_URL and MOSS_ACCESS_TOKEN to the process')
        parsed = urllib.parse.urlsplit(self.base)
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ['localhost', '127.0.0.1']):
            raise ValueError('Moss endpoint must use HTTPS')
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Invalid Moss endpoint')

    def request(self, method, suffix='', data=None, is_binary=False, retry=True):
        raw = data if is_binary else json.dumps(data).encode() if data is not None else None
        headers = {'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/octet-stream' if is_binary else 'application/json'}
        if is_binary:
            headers['X-Content-SHA256'] = hashlib.sha256(raw).hexdigest()
        for attempt in range(4 if retry else 1):
            req = urllib.request.Request(self.base + self.api + suffix, data=raw, headers=headers, method=method)
            try:
                # Authenticated requests must not forward credentials through redirects.
                class NoRedirect(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self, req, fp, code, msg, headers, newurl): return None
                with urllib.request.build_opener(NoRedirect).open(req, timeout=120) as response:
                    body = response.read()
                    return body if response.headers.get_content_type() == 'application/octet-stream' else json.loads(body)
            except urllib.error.HTTPError as error:
                if error.code == 404 and self.api == '/agent-archives':
                    raise ValueError('This Sudowork version lacks the backup connection. Update Sudowork, or run with --config pointing to its local signed-in config file') from None
                if error.code in [401, 403]:
                    raise ValueError('Cloud login expired or access denied; sign into Sudowork again') from None
                if error.code < 500 or attempt == (3 if retry else 0):
                    raise ValueError(f'Cloud operation failed (HTTP {error.code})') from None
            except (OSError, urllib.error.URLError):
                if attempt == (3 if retry else 0):
                    raise ValueError('Cloud connection failed; retry the same command to resume') from None
            time.sleep(2 ** attempt)


def upload(args):
    path = Path(args.archive).resolve()
    manifest = verify_archive(path)
    cloud = Cloud(args.config)
    sha = sha_file(path)
    # Reconcile by content hash after uncertain create responses, so retries do not duplicate a snapshot.
    existing = cloud.request('GET')['agents']
    item = next((x for x in existing if x['sha256'] == sha and x['size'] == path.stat().st_size), None)
    if item is None:
        item = cloud.request('POST', data={'displayName': manifest['displayName'], 'engines': manifest['engines'],
            'size': path.stat().st_size, 'sha256': sha, 'sessionCount': len(manifest['sessions'])}, retry=False)
    agent = item['agentName']
    with path.open('rb') as stream:
        index = 0
        while True:
            chunk = stream.read(item['chunkBytes'])
            if not chunk:
                break
            cloud.request('PUT', f'/{agent}/chunks/{index}', chunk, is_binary=True)
            index += 1
            print(f'Uploaded {min(index * item["chunkBytes"], item["size"])}/{item["size"]} bytes', file=sys.stderr, flush=True)
    return cloud.request('POST', f'/{agent}/complete', {})


def download(args):
    max_chunks = getattr(args, 'max_chunks', 0)
    if max_chunks < 0:
        raise ValueError('max-chunks must be zero or positive')
    cloud = Cloud(args.config)
    agent = urllib.parse.quote(args.agent, safe='')
    item = cloud.request('GET', '/' + agent)
    if item['status'] != 'ready':
        raise ValueError('Cloud snapshot has not completed uploading')
    output = Path(args.output).resolve()
    if output.exists():
        if sha_file(output) == item['sha256']:
            return {'archive': str(output), 'verified': True}
        raise ValueError('Output already exists with different content')
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(output.name + '.partial')
    state_path = output.with_name(output.name + '.download.json')
    identity = {key: item[key] for key in ['agentName', 'sha256', 'size', 'chunkBytes']}
    if partial.exists():
        if not state_path.exists():
            raise ValueError('Partial download has no verification state; choose a new output filename')
        state = json.loads(state_path.read_text(encoding='utf-8'))
        if state.get('identity') != identity:
            raise ValueError('Partial download belongs to a different archive')
    else:
        if state_path.exists():
            raise ValueError('Download state already exists; choose a new output filename')
        partial.touch(exist_ok=False)
        state = {'identity': identity, 'chunks': []}
        state_path.write_text(json.dumps(state), encoding='utf-8')
    with partial.open('r+b') as stream:
        verified = []
        for digest in state['chunks']:
            chunk = stream.read(item['chunkBytes'])
            if hashlib.sha256(chunk).hexdigest() != digest:
                break
            verified.append(digest)
        offset = min(len(verified) * item['chunkBytes'], item['size'])
        stream.seek(offset)
        stream.truncate()
        state['chunks'] = verified
        total_chunks = (item['size'] + item['chunkBytes'] - 1) // item['chunkBytes']
        completed_this_call = 0
        for index in range(len(verified), total_chunks):
            chunk = cloud.request('GET', f'/{agent}/chunks/{index}')
            expected = min(item['chunkBytes'], item['size'] - index * item['chunkBytes'])
            if not isinstance(chunk, bytes) or len(chunk) != expected:
                raise ValueError('Downloaded chunk size mismatch')
            stream.write(chunk)
            stream.flush()
            state['chunks'].append(hashlib.sha256(chunk).hexdigest())
            state_path.write_text(json.dumps(state), encoding='utf-8')
            print(f'Downloaded {stream.tell()}/{item["size"]} bytes', file=sys.stderr, flush=True)
            completed_this_call += 1
            if max_chunks and completed_this_call >= max_chunks and index + 1 < total_chunks:
                return {'archive': str(output), 'status': 'downloading', 'verified': False,
                        'downloadedBytes': stream.tell(), 'size': item['size'], 'agentName': item['agentName']}
    if sha_file(partial) != item['sha256'] or partial.stat().st_size != item['size']:
        raise ValueError('Downloaded archive checksum mismatch')
    verify_archive(partial)
    os.link(partial, output)
    partial.unlink()
    state_path.unlink()
    return {'archive': str(output), 'verified': True, 'sha256': item['sha256'], 'agentName': item['agentName']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', help='Local Sudowork config path; credentials never enter archives')
    commands = parser.add_subparsers(dest='command', required=True)
    scan_cmd = commands.add_parser('scan')
    scan_cmd.add_argument('--home', default=str(Path.home()))
    export = commands.add_parser('export')
    export.add_argument('--engine', choices=['codex', 'claude-code', 'sudocode'], action='append', required=True)
    export.add_argument('--project', action='append')
    export.add_argument('--home', default=str(Path.home()))
    export.add_argument('--output', required=True)
    export.add_argument('--name', required=True)
    for name in ['verify', 'upload']:
        commands.add_parser(name).add_argument('--archive', required=True)
    commands.add_parser('list')
    get = commands.add_parser('download')
    get.add_argument('--agent', required=True)
    get.add_argument('--output', required=True)
    get.add_argument('--max-chunks', type=int, default=0, help='Stop after this many new chunks; repeat the same command until verified (0: unlimited)')
    recover = commands.add_parser('restore')
    recover.add_argument('--archive', required=True)
    recover.add_argument('--destination', required=True)
    args = parser.parse_args()
    if args.command == 'scan': result = scan(Path(args.home))
    elif args.command == 'export': result = export_archive(args)
    elif args.command == 'verify':
        manifest = verify_archive(args.archive)
        result = {'verified': True, 'files': len(manifest['files']), 'sessionRecords': len(manifest['sessions'])}
    elif args.command == 'restore': result = restore(args)
    elif args.command == 'list': result = Cloud(args.config).request('GET')
    elif args.command == 'upload': result = upload(args)
    else: result = download(args)
    emit(result)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, zipfile.BadZipFile, KeyError) as error:
        emit({'error': str(error)})
        sys.exit(1)
