#!/usr/bin/env python3
"""Verify the actual DMG/ZIP applications before qualifying a macOS candidate."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile

from macos_distribution import mounted_dmg, one_app, run


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def verify_app(app, team, identifier, architecture):
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    if info.get('CFBundleIdentifier') != identifier:
        raise ValueError('Unexpected application identifier')
    executable = info.get('CFBundleExecutable', '')
    if not executable or Path(executable).name != executable:
        raise ValueError('Invalid bundle executable')
    arches = run('lipo', '-archs', str(app / 'Contents/MacOS' / executable)).decode().split()
    if arches != [architecture]:
        raise ValueError('Unexpected application architecture')
    run('codesign', '--verify', '--deep', '--strict', '--verbose=4', str(app))
    signature = subprocess.run(['codesign', '--display', '--verbose=4', str(app)],
                               check=True, capture_output=True).stderr.decode()
    if (not re.search(r'^Authority=Developer ID Application:', signature, re.M)
            or not re.search(r'^TeamIdentifier=' + re.escape(team) + r'$', signature, re.M)
            or not re.search(r'^Identifier=' + re.escape(identifier) + r'$', signature, re.M)
            or not re.search(r'^CodeDirectory .*flags=.*\bruntime\b', signature, re.M)):
        raise ValueError('Expected Developer ID, team, identifier and hardened runtime signature')
    code_hash = re.search(r'^CDHash=([a-f0-9]+)$', signature, re.M)
    if not code_hash:
        raise ValueError('Missing application code directory hash')
    run('xcrun', 'stapler', 'validate', str(app))
    run('spctl', '--assess', '--type', 'execute', '--verbose=4', str(app))
    return {'cdhash': code_hash[1], 'version': info.get('CFBundleShortVersionString'),
            'build': info.get('CFBundleVersion')}


def verify(directory, team, identifier, architecture, revision):
    receipt = directory / 'macos-candidate.json'
    receipt.unlink(missing_ok=True)
    if not re.fullmatch(r'[A-Z0-9]{10}', team) or not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Expected team identifier and full source revision')
    if architecture not in ('arm64', 'x86_64'):
        raise ValueError('Unsupported candidate architecture')
    dmgs = list(directory.glob('*.dmg'))
    zips = list(directory.glob('*-mac-*.zip'))
    if len(dmgs) != 1 or len(zips) != 1:
        raise ValueError('Expected exactly one DMG and one macOS update ZIP')
    with tempfile.TemporaryDirectory(prefix='sudowork-signature-') as temporary:
        mount = Path(temporary) / 'mounted'
        with mounted_dmg(dmgs[0], mount, runner=run):
            dmg_app = verify_app(one_app(mount), team, identifier, architecture)
        unpacked = Path(temporary) / 'zip'
        run('ditto', '-x', '-k', str(zips[0]), str(unpacked))
        zip_app = verify_app(one_app(unpacked), team, identifier, architecture)
        if dmg_app != zip_app:
            raise ValueError('DMG and update ZIP contain different signed applications')
    result = {'schema_version': 1, 'kind': 'VerifiedMacOSCandidate', 'source_revision': revision,
              'team_identifier': team, 'bundle_identifier': identifier, 'architecture': architecture,
              'application': dmg_app, 'artifacts': {p.name: digest(p) for p in (dmgs[0], zips[0])},
              'checks': ['developer-id', 'hardened-runtime', 'deep-strict-signature', 'stapled-ticket', 'gatekeeper', 'dmg-zip-parity'],
              'qualification': 'signature verified; installation and first-launch acceptance still required'}
    receipt.write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--team', required=True)
    parser.add_argument('--identifier', default='com.sudowork.app')
    parser.add_argument('--architecture', choices=['arm64', 'x86_64'], required=True)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    verify(args.directory.resolve(), args.team, args.identifier, args.architecture, args.revision)
    print('Verified signed and notarized candidate DMG and update ZIP')
