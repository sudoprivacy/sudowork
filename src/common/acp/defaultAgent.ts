/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_PRESET_AGENT_TYPE } from '@/types/acpTypes';

/**
 * Resolve the default agent key for a fresh session when the user has
 * expressed no preference yet. Used by both the renderer (Guid page)
 * and the main process (CronService) so they agree on "no preference".
 *
 * Enterprise mode defaults to the generic 'remote-agent' (Moss Server);
 * consumer mode defaults to the preset agent type ('scode').
 */
export function defaultAgentForMode(isEnterprise: boolean): string {
  return isEnterprise ? 'remote-agent' : DEFAULT_PRESET_AGENT_TYPE;
}
