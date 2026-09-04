# Site customization module that activates the security hook system.
# When this directory is added to PYTHONPATH, Python automatically imports
# sitecustomize.py at startup, which triggers the hook package's __init__.py
# to install all interceptors (file, network, process) before any user code runs.
import os
import subprocess
from pathlib import Path


def find_hook(path: Path):
    whl_path = os.getenv("HOOK_PYTHON_WHL")
    if whl_path:
        return whl_path
    whl_path = path.parent / "hook-0.0.1-py3-none-any.whl"
    if whl_path.exists():
        return str(whl_path)
    whl_path = path.parent / "dist" / "hook-0.0.1-py3-none-any.whl"
    if whl_path.exists():
        return str(whl_path)
    return None


def install_hook():
    path = Path(__file__).parent
    whl_path = find_hook(path)
    if not whl_path:
        return

    try:
        from pip._internal.cli.main import main

        main(["install", "-t", path, whl_path])
        return
    except ImportError:
        pass

    # noinspection PyBroadException
    try:
        subprocess.check_call(["pip", "install", "-t", path, whl_path])
        return
    except:
        pass

    # noinspection PyBroadException
    try:
        subprocess.check_call(["uv", "pip", "install", "-t", path, whl_path])
        return
    except:
        pass


try:
    import hook
except ImportError:
    install_hook()
    try:
        import hook
    except ImportError:
        pass
