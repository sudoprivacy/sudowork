/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import type { AcpBackendConfig } from '@/types/acpTypes';
import { mainWarn } from '@process/utils/mainLogger';

type ConversationAssistantSkillsDeps = {
  getCustomAgents: () => Promise<AcpBackendConfig[] | undefined>;
  warn: (message: string, error?: unknown) => void;
};

const defaultDeps: ConversationAssistantSkillsDeps = {
  getCustomAgents: async () => {
    const { ProcessConfig } = await import('@process/initStorage');
    return ProcessConfig.get('acp.customAgents').catch((): AcpBackendConfig[] | undefined => undefined);
  },
  warn: (message, error) => {
    mainWarn('ConversationAssistantSkills', message, error);
  },
};

export function normalizeSkillNames(skillNames?: readonly string[]): string[] {
  if (!Array.isArray(skillNames)) {
    return [];
  }

  return skillNames
    .filter((skill): skill is string => typeof skill === 'string')
    .map((skill) => skill.trim())
    .filter(Boolean);
}

export function resolveConversationAssistantId(conversation?: TChatConversation): string | undefined {
  const presetAssistantId = typeof conversation?.extra?.presetAssistantId === 'string' ? conversation.extra.presetAssistantId.trim() : '';
  if (presetAssistantId) {
    return presetAssistantId;
  }

  const customAgentId = typeof conversation?.extra?.customAgentId === 'string' ? conversation.extra.customAgentId.trim() : '';
  if (!customAgentId) {
    return undefined;
  }

  if (Array.isArray(conversation?.extra?.enabledSkills) || customAgentId.startsWith('builtin-')) {
    return customAgentId;
  }

  return undefined;
}

export function areSkillSelectionsEqual(left?: readonly string[], right?: readonly string[]): boolean {
  const normalizedLeft = [...normalizeSkillNames(left)].sort();
  const normalizedRight = [...normalizeSkillNames(right)].sort();

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((skillName, index) => skillName === normalizedRight[index]);
}

export async function resolveLatestConversationEnabledSkills(conversation?: TChatConversation, deps: ConversationAssistantSkillsDeps = defaultDeps): Promise<string[] | undefined> {
  const storedEnabledSkills = Array.isArray(conversation?.extra?.enabledSkills) ? normalizeSkillNames(conversation.extra.enabledSkills) : undefined;
  const assistantId = resolveConversationAssistantId(conversation);

  if (!assistantId) {
    return storedEnabledSkills;
  }

  try {
    const customAgents = await deps.getCustomAgents();
    const agent = customAgents?.find((item) => item.id === assistantId);

    if (agent) {
      return normalizeSkillNames(agent.enabledSkills ?? []);
    }
  } catch (error) {
    deps.warn(`Failed to resolve latest enabled skills for ${assistantId}`, error);
  }

  if (assistantId.startsWith('builtin-')) {
    return storedEnabledSkills ?? [];
  }

  return storedEnabledSkills;
}
