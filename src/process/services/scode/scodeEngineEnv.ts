/**
 * @license
 * Copyright 2026 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Env contract for sudowork's embedded (engine) scode — the single source of
 * truth for what sudowork injects when it spawns scode over ACP.
 *
 * Kept in its own dependency-light module (it only needs {@link scodePaths})
 * so the contract can be asserted directly in tests without dragging in the
 * whole ACP/storage stack.
 */

import { SCODE_CONFIG_PATH, SCODE_HOME } from './scodePaths';

/**
 * Variables sudowork sets on the scode engine process. The caller applies each
 * one ONLY when it isn't already set, so an explicit override still wins.
 */
export function scodeEngineEnvOverrides(): Record<string, string> {
  return {
    // scode's Rust config loader resolves its config home from this, so point it
    // at sudowork's ISOLATED home — relocating both sudocode.json (models/auth)
    // and settings.json (settings/MCP) away from a standalone scode's
    // ~/.nexus/sudocode, so the two products never stomp each other.
    SUDO_CODE_CONFIG_HOME: SCODE_HOME,

    // Lets skill bash scripts locate sudocode.json even when an agent runtime
    // overrides $HOME to a sandbox directory (.sandbox-home/).
    SUDOCODE_CONFIG_PATH: SCODE_CONFIG_PATH,

    // sudowork owns scheduling: it runs its own CronService and NEVER ticks
    // scode's crons.json. Without this the agent could "schedule" a task via
    // scode's CronCreate tool that persists (and even lists under `scode cron
    // list`) but is never fired — an orphan — and would face two scheduling
    // surfaces, only one of which actually runs. scode reads exactly this
    // variable to omit its agent-facing cron tools; the `scode cron` CLI is
    // untouched. Removed once sudowork's scheduling delegates to scode's cron.
    SUDOCODE_DISABLE_CRON_TOOLS: '1',
  };
}
