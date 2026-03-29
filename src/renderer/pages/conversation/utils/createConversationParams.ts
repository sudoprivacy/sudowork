/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from '@/common/storage';
import type { ICreateConversationParams } from '@/common/ipcBridge';
import type { TProviderWithModel } from '@/common/storage';
import { resolveLocaleKey } from '@/common/utils';
import { loadPresetAssistantResources } from '@/renderer/shared/agents/presetAssistantResources';
import type { AvailableAgent } from '@/renderer/shared/agents/types';
import type { AcpBackend, AcpBackendAll } from '@/types/acpTypes';

/**
 * Get the default Gemini model configuration from user settings.
 * Throws if no enabled provider or model is configured.
 * [BUG-3 fix]: callers must call this inside a try block
 */
export async function getDefaultGeminiModel(): Promise<TProviderWithModel> {
  const providers = await ConfigStorage.get('model.config');

  if (!providers || providers.length === 0) {
    throw new Error('No model provider configured');
  }

  const enabledProvider = providers.find((p) => p.enabled !== false);
  if (!enabledProvider) {
    throw new Error('No enabled model provider');
  }

  const enabledModel = enabledProvider.model.find((m) => enabledProvider.modelEnabled?.[m] !== false);

  return {
    id: enabledProvider.id,
    platform: enabledProvider.platform,
    name: enabledProvider.name,
    baseUrl: enabledProvider.baseUrl,
    apiKey: enabledProvider.apiKey,
    useModel: enabledModel || enabledProvider.model[0],
    capabilities: enabledProvider.capabilities,
    contextLimit: enabledProvider.contextLimit,
    modelProtocols: enabledProvider.modelProtocols,
    bedrockConfig: enabledProvider.bedrockConfig,
    enabled: enabledProvider.enabled,
    modelEnabled: enabledProvider.modelEnabled,
    modelHealth: enabledProvider.modelHealth,
  };
}

/**
 * Determine the conversation type from a CLI agent's backend.
 * codex uses ACP path (type: 'acp' + extra.backend = 'codex').
 */
export function getConversationTypeForBackend(backend: string): ICreateConversationParams['type'] {
  switch (backend) {
    case 'openclaw-gateway':
    case 'openclaw':
      return 'openclaw-gateway';
    default:
      // claude, gemini, qwen, codex, iflow, goose, auggie, kimi, opencode, copilot, qoder, codebuddy, droid, vibe, etc.
      // All backends use ACP protocol.
      return 'acp';
  }
}

/**
 * Determine the conversation type from a preset assistant's presetAgentType.
 * ACP-routed types include claude, codebuddy, opencode, qwen, codex.
 * Sudoclaw uses openclaw-gateway type.
 */
export function getConversationTypeForPreset(presetAgentType: string): ICreateConversationParams['type'] {
  // Sudoclaw uses OpenClaw Gateway (WebSocket), not ACP CLI
  if (presetAgentType === 'sudoclaw') {
    return 'openclaw-gateway';
  }
  // All other preset agent types route through ACP
  return 'acp';
}

/**
 * Build ICreateConversationParams for a CLI agent.
 * The backend will automatically fill in derived fields (gateway.cliPath, runtimeValidation, etc.).
 * [BUG-3 fix]: callers must invoke this inside a try block because getDefaultGeminiModel may throw.
 */
export async function buildCliAgentParams(agent: AvailableAgent, workspace: string): Promise<ICreateConversationParams> {
  const { backend, name: agentName, cliPath } = agent;

  const type = getConversationTypeForBackend(backend);

  const extra: ICreateConversationParams['extra'] = {
    workspace,
    customWorkspace: true,
  };

  if (type === 'acp' || type === 'openclaw-gateway') {
    extra.backend = backend as AcpBackendAll;
    extra.agentName = agentName;
    if (cliPath) extra.cliPath = cliPath;
  }

  // ACP/OpenClaw agents don't use the model field at the conversation level
  const model = {} as TProviderWithModel;

  return { type, model, name: agentName, extra };
}

/**
 * Build ICreateConversationParams for a preset assistant.
 * Applies 4-layer fallback for reading rules and skills (BUG-1 fix).
 * Uses resolveLocaleKey() to convert i18n.language to standard locale format (BUG-2 fix).
 * [BUG-3 fix]: callers must invoke this inside a try block because getDefaultGeminiModel may throw.
 */
export async function buildPresetAssistantParams(agent: AvailableAgent, workspace: string, language: string): Promise<ICreateConversationParams> {
  const { customAgentId, presetAgentType = 'claude' } = agent;

  // [BUG-2] Map raw i18n.language to standard locale key
  const localeKey = resolveLocaleKey(language);

  const { rules: presetContext, enabledSkills } = await loadPresetAssistantResources({
    customAgentId,
    localeKey,
  });

  const type = getConversationTypeForPreset(presetAgentType);

  const extra: ICreateConversationParams['extra'] = {
    workspace,
    customWorkspace: true,
    enabledSkills,
    presetAssistantId: customAgentId,
    presetContext,
    // Sudoclaw preset type maps to openclaw-gateway backend
    backend: (presetAgentType === 'sudoclaw' ? 'openclaw-gateway' : presetAgentType) as AcpBackend,
  };

  const model = {} as TProviderWithModel;

  return { type, model, name: agent.name, extra };
}
