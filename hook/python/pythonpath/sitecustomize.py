# Site customization module that activates the security hook system.
# When this directory is added to PYTHONPATH, Python automatically imports
# sitecustomize.py at startup, which triggers the hook package's __init__.py
# to install all interceptors (file, network, process) before any user code runs.
# noinspection PyUnusedImports
import hook
