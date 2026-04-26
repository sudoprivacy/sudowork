/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AvailableAgent } from './types';

export const AVAILABLE_AGENTS_SWR_KEY = 'acp.agents.available';

export interface FilterAgentsOptions {
  /** Enterprise mode: filter local agents based on server policy */
  enterpriseMode?: boolean;
  /** Whether server allows local agents */
  localAgentEnabled?: boolean;
  /** Allowed local agent types from server */
  localAgentTypes?: string[];
}

export function filterAvailableAgentsForUi(availableAgents: AvailableAgent[], options?: FilterAgentsOptions): AvailableAgent[] {
  const { enterpriseMode, localAgentEnabled, localAgentTypes } = options ?? {};

  if (!enterpriseMode) {
    return availableAgents;
  }

  // Enterprise mode: filter agents based on server policy
  if (!localAgentEnabled) {
    // Hide all local CLI agents, keep only presets and remote agents
    return availableAgents.filter((agent) => agent.isRemoteAgent || agent.isPreset);
  }

  if (localAgentTypes && localAgentTypes.length > 0) {
    // Only show agents of allowed types, plus presets and remote agents
    return availableAgents.filter(
      (agent) =>
        agent.isRemoteAgent ||
        agent.isPreset ||
        (agent.backend && localAgentTypes.includes(agent.backend)),
    );
  }

  return availableAgents;
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
