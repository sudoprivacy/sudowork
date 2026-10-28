"""Shared lifecycle for read-only macOS distribution images."""
from contextlib import contextmanager
import subprocess


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=60).stdout


def one_app(directory):
    apps = [path for path in directory.glob('*.app') if path.is_dir() and not path.is_symlink()]
    if len(apps) != 1:
        raise ValueError('Expected exactly one application in distribution')
    return apps[0]


@contextmanager
def mounted_dmg(image, mount, runner=run):
    mount.mkdir()
    runner('hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen',
           '-mountpoint', str(mount), str(image))
    try:
        yield mount
    finally:
        try:
            runner('hdiutil', 'detach', str(mount))
        except subprocess.CalledProcessError as error:
            if error.returncode != 16:
                raise
            # macOS services may retain a read-only image after its app is copied.
            runner('hdiutil', 'detach', '-force', str(mount))
