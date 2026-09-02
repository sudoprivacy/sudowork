/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AvailableAgent } from './types';

export const AVAILABLE_AGENTS_SWR_KEY = 'acp.agents.available';

/**
 * Single source of truth for which agents are visible in the UI.
 * Backend `enabled` flag controls detection/MCP sync; this function
 * controls what the user sees after detection.
 */
export function filterAvailableAgentsForUi(availableAgents: AvailableAgent[]): AvailableAgent[] {
  return availableAgents.filter((agent) => agent.backend !== 'gemini');
}

export function splitConversationDropdownAgents(availableAgents: AvailableAgent[]): {
  cliAgents: AvailableAgent[];
  presetAssistants: AvailableAgent[];
} {
  return {
    cliAgents: availableAgents.filter((agent) => agent.backend !== 'custom' && !agent.isPreset),
    presetAssistants: availableAgents.filter((agent) => agent.isPreset === true),
  };
}
