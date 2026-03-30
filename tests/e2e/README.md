# E2E Testing

Screenshot-driven E2E tests for Sudowork, powered by ai-dev-browser.

Aligned with [human-browser-primitives](https://github.com/sudoprivacy/human-browser-primitives) spec.

## Architecture

```
human-browser-primitives/spec.md    ← W3C core primitive definitions
ops-spec.yaml                       ← app-specific convenience param extensions
generate.py                         ← reads both specs → generates code

primitives/                          ← AUTO-GENERATED, DO NOT EDIT
  key_down.py, pointer_move.py ...   #   pure W3C implementations, core params only

ops/                                 ← AUTO-GENERATED, DO NOT EDIT
  key_down.py, pointer_move.py ...   #   thin wrappers: core + convenience params

utils.py                            ← hand-written resolver functions
run_op.py                           ← CLI entry point
runner.py                           ← YAML test case executor
```

## Primitives (from spec)

### Input
| Primitive | Core Params | Convenience Params |
|---|---|---|
| `key_down` | `value` | *(React fallback auto-detected)* |
| `key_up` | `value` | |
| `pointer_down` | `button` | |
| `pointer_up` | `button` | |
| `pointer_move` | `x`, `y`, `duration`, `origin` | |
| `scroll` | `x`, `y`, `delta_x`, `delta_y` | |
| `pause` | `duration` (ms) | |

### Observation
| Primitive | Core Params | Convenience Params |
|---|---|---|
| `screenshot` | | `path` |
| `get_text` | `element` | `shadow_dom` |
| `get_attribute` | `element`, `name` | |
| `is_displayed` | `element` | |

## Usage

```bash
# Single primitive
python tests/e2e/run_op.py --port 9230 --op pointer_move --x 80 --y 117
python tests/e2e/run_op.py --port 9230 --op pointer_down
python tests/e2e/run_op.py --port 9230 --op pointer_up
python tests/e2e/run_op.py --port 9230 --op key_down --value Enter
python tests/e2e/run_op.py --port 9230 --op key_up --value Enter
python tests/e2e/run_op.py --port 9230 --op screenshot --path out.png

# Regenerate from specs
python tests/e2e/generate.py

# Run test cases
python tests/e2e/runner.py --port 9230 --case model-command
```

## Rules

1. `primitives/` and `ops/` are AUTO-GENERATED. Never hand-edit.
2. To change a primitive: edit `human-browser-primitives/spec.md` → `generate.py`.
3. To change convenience params: edit `ops-spec.yaml` → `generate.py`.
4. To change resolver logic: edit `utils.py` (only hand-written code).
