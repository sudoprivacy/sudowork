# E2E Testing

Screenshot-driven E2E tests for Sudowork, powered by ai-dev-browser.

## What is an Op?

An op is ONE atomic human intention:

- `type_text` — human types text (no Enter)
- `send_message` — human sends a message (type + Enter)
- `click_element` — human clicks something
- `screenshot` — human looks at the screen
- `stop_conversation` — human clicks the stop button

NOT an op: "type text then send then wait for response" — that's 3 intentions.

## Architecture

```
run_op.py          — CLI entry: invoke a single op from the shell
runner.py          — YAML case executor: run multi-step test cases
ops/registry.py    — shared: op discovery + invocation (used by both)
ops/*.py           — one file per op, auto-discovered
cases/*.yaml       — test cases referencing ops
```

## Rules

1. Each op = one human intention. If you'd describe it with "and then", split it.
2. Ops must NOT call AI. They are deterministic scripts.
3. Ops use CDP events (human-like) over DOM manipulation (js_exec).
   Use js_exec ONLY when CDP can't reach the element (e.g., React state setter).
4. Both E2E runner and Doctor use ops via `ops/registry.py`. No raw `ai_dev_browser.tools.*` calls.
5. Auto-discovered: drop a `.py` file in `ops/`, export an async function matching the filename.

## Usage

```bash
# Run a single op (used by Doctor and interactive testing)
python tests/e2e/run_op.py --port 9230 --op screenshot
python tests/e2e/run_op.py --port 9230 --op click_element --text "技能商店"
python tests/e2e/run_op.py --port 9230 --op send_message --text "hello"
python tests/e2e/run_op.py --port 9230 --op type_text --text "/model"
python tests/e2e/run_op.py --port 9230 --op file_bug --title "bug" --body "desc"
python tests/e2e/run_op.py --list  # List all available ops

# Run YAML test cases
python tests/e2e/runner.py --port 9230
python tests/e2e/runner.py --port 9230 --case model-command
```
