"""Reusable CI e2e state seeders.

Both scripts here are idempotent and callable from either CI (workflow steps)
or a local dev box (manual reproduction of a failing case).

- seed_scode_env.py   -- extract scode binary into SCODE_HOME + write sudocode.json
                         pointed at a mock LLM upstream (or a real one)
- spawn_mock_llm.py   -- git-clone + cargo build sudocode's mock-anthropic-service,
                         spawn it, capture MOCK_ANTHROPIC_BASE_URL for downstream

Neither seeder ships live-network deps (no real LLM creds). CI does not run live
PTY tests -- the mock upstream is the SSOT for structural regression.
"""
