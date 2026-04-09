/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackend } from '@/types/acpTypes';
import type { AvailableAgent } from './types';

export const AVAILABLE_AGENTS_SWR_KEY = 'acp.agents.available';

/**
 * v1.0.3: Only SudoClaw and Claude Code CLI agents are visible in the UI.
 * Other CLI agents (Gemini CLI, Qwen Code, etc.) are hidden — not deleted.
 * Custom/preset agents are still shown since they route through available backends.
 */
export const V1_VISIBLE_AGENT_BACKENDS: ReadonlySet<AcpBackend> = new Set(['claude', 'openclaw-gateway']);

export function filterAvailableAgentsForUi(availableAgents: AvailableAgent[]): AvailableAgent[] {
  return availableAgents.filter((agent) => {
    // Always keep custom/preset agents (they route through available backends)
    if (agent.backend === 'custom') return true;
    // v1.0.3: Only show SudoClaw and Claude Code
    return V1_VISIBLE_AGENT_BACKENDS.has(agent.backend);
  });
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
