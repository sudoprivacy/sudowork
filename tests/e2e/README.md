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
| Primitive | Core Params | Convenience Params |
|---|---|---|
| `key_down` | `value` | *(React fallback auto-detected)* |
| `key_up` | `value` | |
| `pointer_down` | `button` | |
| `pointer_up` | `button` | |
| `pointer_move` | `x`, `y`, `duration`, `origin` | |
| `scroll` | `x`, `y`, `delta_x`, `delta_y` | |
| `pause` | `duration` (ms) | |

### Input — Element Interaction (W3C §12.5)
| Primitive | Core Params | Convenience Params |
|---|---|---|
| `click` | `x`, `y`, `button` | |

### Observation
| Primitive | Core Params | Convenience Params |
|---|---|---|
| `screenshot` | `path` | |
| `get_text` | `element` | `shadow_dom` |
| `get_attribute` | `element`, `name` | |
| `is_displayed` | `element` | |

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

## Rules

1. `primitives/` and `ops/` are AUTO-GENERATED. Never hand-edit.
2. To change a primitive: edit `human-browser-primitives/spec.md` -> `generate.py`.
3. To change convenience params: edit `ops-spec.yaml` -> `generate.py`.
4. To change resolver logic: edit `utils.py` (only hand-written code).
