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

## Rules

1. `primitives/` and `ops/` are AUTO-GENERATED. Never hand-edit.
2. To change a primitive: edit `human-browser-primitives/spec.md` -> `generate.py`.
3. To change convenience params: edit `ops-spec.yaml` -> `generate.py`.
4. To change resolver logic: edit `utils.py` (only hand-written code).
