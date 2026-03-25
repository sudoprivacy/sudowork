# E2E Testing

Screenshot-driven E2E tests for Sudowork, powered by ai-dev-browser.

## Architecture

```
ops/    — Sudowork UI primitives (pure script, no AI, no tokens)
cases/  — Test cases in YAML (reference ops only)
runner.py — Executes cases, reports results
```

## Rules

1. `ops/` must NOT call AI. They are deterministic scripts.
2. AI is used ONLY via `screenshot_and_judge` op — for visual verification.
3. When you need a new UI interaction, add an op to `ops/`, not inline code in YAML.
4. Prefer human-like interaction (CDP events) over DOM manipulation (js_exec).
   Use js_exec only when CDP can't reach the element.

## Usage

```bash
# 1. Start Sudowork with CDP enabled
NEXUS_CDP_PORT=9232 node scripts/launch-dev.js

# 2. Run all tests
python tests/e2e/runner.py --port 9232

# 3. Run specific case
python tests/e2e/runner.py --port 9232 --case model-command
```
