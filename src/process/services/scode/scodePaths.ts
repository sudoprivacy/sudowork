/**
 * @license
 * Copyright 2026 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for where sudowork's **embedded (engine) scode** keeps
 * its binary and config.
 *
 * sudowork drives scode as an internal engine; a user may ALSO install standalone
 * scode from its own installer. Sharing one directory (the old behaviour) made the
 * two stomp each other's config + binary. So sudowork's engine-scode is isolated
 * here, mirroring how Claude Desktop and Claude Code keep separate config homes:
 *
 *   - sudowork engine-scode → ~/.nexus/sudowork/sudocode/   (this file)
 *   - standalone scode      → ~/.nexus/sudocode/            (its own default; untouched)
 *
 * Every path below is derived from {@link SCODE_HOME}. Do NOT re-derive
 * `~/.nexus/sudowork/sudocode` (or the legacy `~/.nexus/sudocode`) anywhere else —
 * import from this module. The `no-hardcoded-scode-home` guard test enforces it.
 *
 * scode's own config loader (Rust) resolves its config home from the
 * `SUDO_CODE_CONFIG_HOME` env var, so sudowork launches scode with that set to
 * {@link SCODE_HOME}; see acpConnectors. That relocates BOTH `sudocode.json`
 * (models/auth) and `settings.json` (settings/MCP) in one place.
 */

import os from 'os';
import path from 'path';

/** Isolated home for sudowork's embedded scode (binary + config live here). */
export const SCODE_HOME = path.join(os.homedir(), '.nexus', 'sudowork', 'sudocode');

/**
 * Legacy shared home = standalone scode's default config home
 * (`SUDO_CODE_CONFIG_HOME` default in sudocode `config.rs`). Referenced ONLY for
 * the one-time first-run migration (copy → isolate) in ScodeInstallService.
 */
export const LEGACY_SCODE_HOME = path.join(os.homedir(), '.nexus', 'sudocode');

/** `sudocode.json` — models / auth / providers (scode `load_sudocode_config`). */
export const SCODE_CONFIG_PATH = path.join(SCODE_HOME, 'sudocode.json');

/** `settings.json` — runtime settings + MCP servers (scode `discover`). */
export const SCODE_SETTINGS_PATH = path.join(SCODE_HOME, 'settings.json');

/** Config files copied once from {@link LEGACY_SCODE_HOME} on first isolation. */
export const SCODE_MIGRATED_ENTRY_NAMES = ['sudocode.json', 'scode.json', 'settings.json', 'settings.local.json', 'AGENTS.md', 'skills'] as const;
