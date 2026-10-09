/**
 * @license
 * Copyright 2026 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for where sudowork's **embedded (engine) scode** keeps
 * its binary, and which config home it reads.
 *
 * sudowork is a UI over sudocode, so it isolates the same way any two sudocode
 * instances do: ONE shared config home holding the account/model definitions,
 * with per-instance differences layered on top as project config. Forking a
 * second config home made the same accounts and models exist twice and drift
 * apart — the engine there sat on a stale version with no accounts at all.
 *
 *   - config (accounts/models/settings) → ~/.nexus/sudocode/          (SHARED SSOT)
 *   - the pinned engine binary          → ~/.nexus/sudowork/sudocode/ (isolated)
 *
 * Only the BINARY stays isolated: sudowork pins its own engine version, which is
 * a packaging concern and says nothing about whose configuration it should read.
 *
 * Every path below comes from this module. Do NOT re-derive a home-level
 * `~/.nexus/sudocode` or `~/.nexus/sudowork/sudocode` anywhere else — the
 * `no-hardcoded-scode-home` guard test enforces it.
 *
 * scode's own config loader (Rust) resolves its config home from the
 * `SUDO_CODE_CONFIG_HOME` env var, so sudowork launches scode with that set to
 * {@link SCODE_CONFIG_HOME} (see scodeEngineEnv), while the binary it launches
 * comes from {@link SCODE_BIN_HOME} (see AcpDetector).
 */

import os from 'os';
import path from 'path';

/** Isolated home for sudowork's pinned engine binary. Config does NOT live here. */
export const SCODE_BIN_HOME = path.join(os.homedir(), '.nexus', 'sudowork', 'sudocode');

/**
 * Shared config home — the same directory a standalone scode uses by default
 * (`SUDO_CODE_CONFIG_HOME` default in sudocode `config.rs`). Accounts and models
 * are defined here exactly once; anything that must differ per instance belongs
 * in a project layer (`<cwd>/.nexus/sudocode/settings.local.json`), which scode
 * already merges over the global one — not in a second home.
 */
export const SCODE_CONFIG_HOME = path.join(os.homedir(), '.nexus', 'sudocode');

/** `sudocode.json` — models / auth / providers (scode `load_sudocode_config`). */
export const SCODE_CONFIG_PATH = path.join(SCODE_CONFIG_HOME, 'sudocode.json');

/** `settings.json` — runtime settings + MCP servers (scode `discover`). */
export const SCODE_SETTINGS_PATH = path.join(SCODE_CONFIG_HOME, 'settings.json');
