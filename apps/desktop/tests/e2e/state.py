"""Shared state between runner and ops (case boundaries etc).

Module-level — runner writes, ops read. Kept separate from ops/ because
ops/ is meant to be the pure action surface; runner state leaking in
would muddy that. CASE_START_MS is set by runner.run_case before the
first step of each case so db_audit can filter messages "since this run".
"""

CASE_START_MS: int = 0  # epoch ms — runner sets per case
CASE_NAME: str = ""
