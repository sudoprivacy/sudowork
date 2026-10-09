@echo off
rem sudowork `browser` dispatcher (Windows) — thin shim to browser_helper.py.
rem Handles --list / --help / tool dispatch and POSTs stdout to sidechannel.
python "%~dp0browser_helper.py" %*
exit /b %errorlevel%
