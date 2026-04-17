@echo off
setlocal EnableDelayedExpansion
:: ai-dev-browser dispatcher (sudowork-side, Windows).
::
:: Thin wrapper: `aidb <tool> [args]` -> `python -m ai_dev_browser.tools.<tool> [args]`.
:: Skips uv / venv bootstrap — sudowork pre-configures PYTHONPATH when it
:: starts the openclaw gateway, so `python -m ai_dev_browser.tools.*` resolves
:: directly. ~50ms per call.

:: Resolve ai_dev_browser tools directory. Prefer PYTHONPATH (set by sudowork),
:: fall back to the stable system-skills junction location.
set "TOOLS_DIR=%PYTHONPATH%\ai_dev_browser\tools"
:: If PYTHONPATH contains multiple paths (; separated on Windows), take the first.
for /f "tokens=1 delims=;" %%p in ("%PYTHONPATH%") do set "TOOLS_DIR=%%p\ai_dev_browser\tools"
if not exist "%TOOLS_DIR%" (
    set "TOOLS_DIR=%USERPROFILE%\.nexus\skills\_system\browser\ai_dev_browser\tools"
)

if "%~1"=="" goto :help
if "%~1"=="--help" goto :help
if "%~1"=="-h" goto :help

if "%~1"=="--list" goto :list

:: Dispatch. Replace hyphens in tool name with underscores (Python module rule).
set "tool=%~1"
set "tool=%tool:-=_%"
shift
:: %* still has the original first arg; build forwarded args manually.
set "forwarded="
:collect_args
if "%~1"=="" goto :run
if defined forwarded (set "forwarded=%forwarded% %1") else (set "forwarded=%1")
shift
goto :collect_args

:run
python -m "ai_dev_browser.tools.%tool%" %forwarded%
exit /b %errorlevel%

:list
if not exist "%TOOLS_DIR%" (
    echo Error: tools directory not found: %TOOLS_DIR% 1>&2
    exit /b 1
)
for %%f in ("%TOOLS_DIR%\*.py") do (
    set "name=%%~nf"
    if not "!name:~0,1!"=="_" echo !name!
)
exit /b 0

:help
echo Usage: aidb ^<tool^> [args]
echo        aidb --list            list available tools
echo        aidb ^<tool^> --help     tool-specific help
echo.
echo Tool files: %TOOLS_DIR%
exit /b 0
