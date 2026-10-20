# E2E Testing

Screenshot-driven E2E tests for Sudowork, powered by ai-dev-browser.

Aligned with [human-browser-primitives](https://github.com/sudoprivacy/human-browser-primitives) spec.

## Architecture

```
human-browser-primitives/spec.md    <- W3C core primitive definitions
ops-spec.yaml                       <- app-specific convenience param extensions
generate.py                         <- reads both specs -> generates code

primitives/                          <- AUTO-GENERATED, DO NOT EDIT
  key_down.py, click.py ...          #   W3C implementations via ai-dev-browser

ops/                                 <- AUTO-GENERATED, DO NOT EDIT
  key_down.py, click.py ...          #   thin wrappers: core + convenience params

utils.py                            <- hand-written resolver functions
run_op.py                           <- CLI entry point
runner.py                           <- YAML test case executor
```

## Primitives (from spec)

### Input — Actions API (W3C §15)

| Primitive      | Core Params                    | Convenience Params               |
| -------------- | ------------------------------ | -------------------------------- |
| `key_down`     | `value`                        | _(React fallback auto-detected)_ |
| `key_up`       | `value`                        |                                  |
| `pointer_down` | `button`                       |                                  |
| `pointer_up`   | `button`                       |                                  |
| `pointer_move` | `x`, `y`, `duration`, `origin` |                                  |
| `scroll`       | `x`, `y`, `delta_x`, `delta_y` |                                  |
| `pause`        | `duration` (ms)                |                                  |

### Input — Element Interaction (W3C §12.5)

| Primitive | Core Params        | Convenience Params |
| --------- | ------------------ | ------------------ |
| `click`   | `x`, `y`, `button` |                    |

### Observation

| Primitive       | Core Params       | Convenience Params |
| --------------- | ----------------- | ------------------ |
| `screenshot`    | `path`            |                    |
| `get_text`      | `element`         | `shadow_dom`       |
| `get_attribute` | `element`, `name` |                    |
| `is_displayed`  | `element`         |                    |

## Usage

```bash
# Click (preferred for most interactions)
python tests/e2e/run_op.py --port 9230 --op click --x 125 --y 188

# Screenshot (CSS-scaled, coordinates match click coordinates)
python tests/e2e/run_op.py --port 9230 --op screenshot --path out.png

# Low-level pointer (for drag operations)
python tests/e2e/run_op.py --port 9230 --op pointer_move --x 80 --y 117
python tests/e2e/run_op.py --port 9230 --op pointer_down
python tests/e2e/run_op.py --port 9230 --op pointer_up

# Keyboard
python tests/e2e/run_op.py --port 9230 --op key_down --value Enter
python tests/e2e/run_op.py --port 9230 --op key_up --value Enter

# Regenerate from specs
python tests/e2e/generate.py

# Run test cases
python tests/e2e/runner.py --port 9230 --case model-command
```

## Running notes

- **Native modules must match the app's Electron ABI.** When driving a local
  dev app, `better-sqlite3` (and other `.node` modules) must be built for the
  _current_ Electron — do NOT copy a binding from a sibling worktree on a
  different Electron version. A mismatched binding boots fine but **segfaults
  the main process** on some paths (e.g. creating an scode conversation), which
  reads as the app "crashing on send". Rebuild for the current version:
  `bunx electron-builder install-app-deps` (or, with MSVC env sourced,
  `npx electron-rebuild --only better-sqlite3 --force --electron-version <ver>`).
- **UTF-8 is built in.** The runner reads YAML as UTF-8 and reconfigures
  stdout/stderr, so Chinese case names / labels / judge reasons work on a
  Windows GBK console with no `PYTHONUTF8=1` / `PYTHONIOENCODING` needed.
- **Don't wrap the runner in an external `timeout`.** Every op has a hard
  per-op timeout (derived from the step's own `timeout:` + a grace window; a
  flat default otherwise), so a stalled CDP call can't wedge the suite. An
  external `timeout 280` fires mid-legitimate-wait (a 3-phase API case can
  legitimately spend >300s across several `wait_for_response` steps) and
  orphans the CDP child processes.
- **Progress heartbeat.** Each step prints `▶ [i] <op> …` before it runs and
  its elapsed time after, so a slow/stalled op is visible immediately instead
  of a silent terminal.
- **Locale is deterministic per case.** A case declares `locale: en-US` (the
  default) or `locale: zh-CN`; the runner forces it before the case so text
  selectors and content judges never depend on the user's ambient app
  language. Chinese-content cases carry `locale: zh-CN`; English-label cases
  get the default.
- **Per-case prelude.** Before each case the runner runs, in order,
  `dismiss_init_dialog` → `set_locale` → `reset_conversation` (fresh new-chat
  view, so cases don't inherit each other's conversation state). All three are
  idempotent, so a case that also scripts one in its own `steps` just no-ops
  the repeat.

## Shared browser: actual model and human handoff

`live_shared_browser.py` drives a running Electron app through trusted CDP
mouse and keyboard input. Configure a real Sudo Code model in the app first,
and use a dedicated test profile with a working Python installation. The app
must use a runtime with acknowledged tool pause support (Sudo Code 0.2.31+).

```powershell
python -m pip install aiohttp
python apps/desktop/tests/e2e/live_shared_browser.py --port 9232 --output C:/Users/Public/desktop-browser-live
```

Run this command from the repository root. The output directory must be new.
The test creates a real task and local HTTP page, asks the actual model to
launch headful Chrome, takes control through BrowserPanel, opens the separate
viewer, replaces an AI-populated field with Unicode text and submits once.
After Return to AI, it waits for the finished model turn to report the exact
human value and page status. It also checks the existing `/browser` commands
against the same session. Screenshots and `evidence.json` retain the result.

Use `--controls-window` to hide BrowserPanel and perform the same handoff from
the compact Browser controls window. The test opens the full viewer from that
window, verifies its trusted desktop bridge, and requires the actual fixture to
receive the human's trusted input before submitting. When the local Electron
test launcher records native window metadata, pass
`--windows-evidence <path-to-window-metadata.json>` to check the compact window
is visible, always on top and sized independently of the full viewer. The
compact window polls control state without attaching a pixel viewer.

The app and its owned browser stay open for inspection. Close the app normally
afterward so its shutdown lifecycle stops its own Chrome and worker. If a
failed run left human control active, recover it through the original task's
panel before starting another run; do not delete the control journal.

The PR workflow `pr-desktop-browser-live.yml` separately runs real native Chrome
through the host HTTP and stdio paths on Windows and Linux, both headless and
headful. Those tests use the official published worker and no model credentials.
They verify authenticated discovery without allocation, takeover fences,
session identity, exact trusted input, cookies, file bytes and shutdown. They
complement the actual model/UI test above.

### Existing personal Chrome

Use `live_shared_browser.py --existing-profile` with a dedicated running fixture
Chrome and its installed extension bridge. The test bootstraps an actual model
session, selects **Connect my Chrome** through the real panel confirmation,
returns control with the browser task, and exercises the ordinary viewer/input/
model-readback journey. It explicitly disconnects the personal profile at the
end. Keep the fixture Chrome open while the app shuts down and verify that the
app did not close it. Do not point acceptance at an everyday personal profile.

For a fresh local app, `--offline-entry` chooses the normal offline login entry.
That entry clears online-account residue, so `--model-config <private-json>` can
configure the acceptance account through the ordinary settings editor afterward.
Keep this file outside the repository and remove its copies and backups after
the owned instance stops. The driver verifies actual assistant text, the
composer's finished state, fully visible inputs and one trusted submission.
Failed runs retain command acknowledgements and viewer geometry without logging
CDP input values or credentials.

`test_personal_chrome_host.py` separately tests the actual Desktop host and public
worker, without a model or Electron renderer. It reuses the pinned SDK's real
extension fixture, seeds a login cookie before attachment, and verifies exact
input, one submission, observation after Return and Chrome/cookie/input survival
after host shutdown. The PR workflow runs all four combinations of headless/
headful Chrome and both supported extension WebSocket backends on Linux/Windows.
The fixture requires Chrome for Testing or Chromium with extension loading.

```powershell
bun run --filter=@sudowork/contracts build
bun build apps/desktop/tests/integration/localBrowserWorker.live.ts --target=node --format=esm --outfile=desktop-browser-live.mjs
$env:AI_DEV_BROWSER_TEST_EXTENSION_CHROME = 'C:/path/to/isolated-fixture-chrome.exe'
$env:SUDOWORK_PERSONAL_HOST_JOURNEY = (Resolve-Path desktop-browser-live.mjs).Path
python -m pytest -v apps/desktop/tests/e2e/test_personal_chrome_host.py --basetemp C:/path/to/new-evidence
```

The default SDK fixture source is `vendor/ai-dev-browser`. Local SDK development
can explicitly select another checkout with `SUDOWORK_BROWSER_SDK_SOURCE`; the
installed worker and fixture source must match. This selects fixture helpers
only; the host still loads the installed distribution without a source-path
override. Install a matching wheel or editable package in the test environment.
The test leaves its evidence and
only closes its own temporary Chrome, bridge and host processes.

The native journey can also exercise the adapter from an actual unpacked
installation. Build `localBrowserWorker.live.ts` as in the PR workflow, then run
it with `--stdio --packaged-resources <installation/resources>` and optionally
`--electron-executable <installation/Sudowork.exe>`. The latter uses Electron's
Node mode, matching the application's fallback when a standalone Node runtime
is unavailable. Set `SUDOWORK_BROWSER_LIVE_PYTHON` to the official public worker
environment. This verifies packaged resources instead of the repository copy.
The packaging hook rejects a missing or empty browser adapter on every platform.

Pass `--pending-native-question` to `live_shared_browser.py` to take control
while the actual model is waiting on its native question card. The journey
requires the card to show cancellation, stops treating chat input as an answer,
and completes the same trusted human edit and fresh model readback after return.

### First-use browser runtime installation

`live_browser_runtime_install.py` launches actual Electron with a fresh isolated
home and user-data directory. Its bundled entry calls the product's
`PythonRuntimeService.prepareBrowserWorkerRuntime()`, creates the app-owned venv
and installs the pinned worker from public PyPI. It checks the installed package
path, version, absence of a source override and reuse on the second call. It
uses no model credentials and leaves the user's Python packages unchanged.
The Windows/Linux PR workflow runs this separately from the preinstalled-worker
journeys and uploads its receipt and Electron log.

```powershell
bun build apps/desktop/tests/integration/browserRuntimeInstall.live.ts --tsconfig-override=apps/desktop/tsconfig.json --target=node --format=cjs --external electron --outfile=desktop-browser-install-live.cjs
python apps/desktop/tests/e2e/live_browser_runtime_install.py --bundle desktop-browser-install-live.cjs --output C:/path/to/new-installer-evidence --version 0.58.0
```

Use `xvfb-run -a` for this command on Linux without a display. A working Python
installation must be available, as required by the product's normal setup flow.

## Rules

1. `primitives/` and `ops/` are AUTO-GENERATED. Never hand-edit.
2. To change a primitive: edit `human-browser-primitives/spec.md` -> `generate.py`.
3. To change convenience params: edit `ops-spec.yaml` -> `generate.py`.
4. To change resolver logic: edit `utils.py` (only hand-written code).
