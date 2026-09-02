/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Determines whether the slash command autocomplete list should be enabled.
 *
 * @returns true — slash commands are always available for all conversation types.
 */
export function isSlashCommandListEnabled(): boolean {
  return true;
}
