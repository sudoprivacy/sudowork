@echo off
rem ai-dev-browser dispatcher (sudowork-side, Windows) — thin shim to
rem aidb_helper.py. See aidb_helper.py for the full rationale (the helper
rem handles --list / --help / tool dispatch AND POSTs the tool's stdout to
rem the sudowork sidechannel; openclaw's native exec result would otherwise
rem ship only a short meta description).
python "%~dp0aidb_helper.py" %*
exit /b %errorlevel%
