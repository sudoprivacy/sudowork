#!/usr/bin/env python3
"""Install the built DMG into an isolated directory and execute its version mode."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import tempfile

from macos_distribution import mounted_dmg, one_app, run


def verify_install(directory):
    images = list(directory.glob('*.dmg'))
    if len(images) != 1:
        raise ValueError('Expected exactly one DMG for installation')
    with tempfile.TemporaryDirectory(prefix='sudowork-install-') as temporary:
        root = Path(temporary)
        installed = root / 'installed'
        installed.mkdir()
        with mounted_dmg(images[0], root / 'mounted', runner=run) as mount:
            source = one_app(mount)
            run('ditto', str(source), str(installed / source.name))
        app = one_app(installed)
        with (app / 'Contents/Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        executable = info.get('CFBundleExecutable', '')
        if not executable or Path(executable).name != executable:
            raise ValueError('Invalid bundle executable')
        binary = app / 'Contents/MacOS' / executable
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise ValueError('Installed application executable is missing')
        run(str(binary), '--version')
        return {'installed_and_executed': True, 'version': info.get('CFBundleShortVersionString')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify_install(args.directory.resolve())))
