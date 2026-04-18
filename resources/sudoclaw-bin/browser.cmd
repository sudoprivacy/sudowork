@echo off
rem sudowork `browser` dispatcher (Windows) — thin shim to browser_helper.py.
rem See browser_helper.py for the full rationale (the helper handles --list /
rem --help / tool dispatch AND POSTs the tool's stdout to the sudowork
rem sidechannel; openclaw's native exec result would otherwise ship only a
rem short meta description).
python "%~dp0browser_helper.py" %*
exit /b %errorlevel%
