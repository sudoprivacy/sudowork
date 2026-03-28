# E2E Testing

Screenshot-driven E2E tests for Sudowork, powered by ai-dev-browser.

## What is an Op?

An op is ONE atomic human-computer interaction primitive:

- `type_text` — type text into a field
- `press_key` — press a key or key combo (Enter, Ctrl+Enter, Escape)
- `mouse_click` — click at coordinates or on an element (CDP mouse events)
- `screenshot` — capture the screen
- `get_page_text` — read all visible text

NOT an op: "type text then press enter" — that's 2 primitives.

## Architecture

```
run_op.py          — CLI entry: invoke a single op from the shell
runner.py          — YAML case executor: run multi-step test cases
ops/registry.py    — shared: op discovery + invocation (used by both)
ops/*.py           — one file per op, auto-discovered
cases/*.yaml       — test cases referencing ops
```

## Rules

1. Each op = one HCI primitive. If you'd describe it with "and then", split it.
2. Ops must NOT call AI. They are deterministic scripts.
3. Ops use CDP events (human-like) over DOM manipulation (js_exec).
   Use js_exec ONLY when CDP can't reach the element (e.g., React state setter).
4. Both E2E runner and Doctor use ops via `ops/registry.py`. No raw `ai_dev_browser.tools.*` calls.
5. Auto-discovered: drop a `.py` file in `ops/`, export an async function matching the filename.

## Usage

```bash
# Run a single op (used by Doctor and interactive testing)
python tests/e2e/run_op.py --port 9230 --op screenshot
python tests/e2e/run_op.py --port 9230 --op mouse_click --text "技能商店"
python tests/e2e/run_op.py --port 9230 --op type_text --text "/model"
python tests/e2e/run_op.py --port 9230 --op press_key --key Ctrl+Enter
python tests/e2e/run_op.py --port 9230 --op file_bug --title "bug" --body "desc"
python tests/e2e/run_op.py --list  # List all available ops

# Run YAML test cases
python tests/e2e/runner.py --port 9230
python tests/e2e/runner.py --port 9230 --case model-command
```
