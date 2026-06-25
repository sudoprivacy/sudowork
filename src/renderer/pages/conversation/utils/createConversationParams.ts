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
import { DEFAULT_PRESET_AGENT_TYPE, resolvePresetAgentBackend, type AcpBackendAll } from '@/types/acpTypes';

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
export function getConversationTypeForBackend(): ICreateConversationParams['type'] {
  // All backends use ACP protocol.
  // claude, gemini, qwen, codex, iflow, goose, auggie, kimi, opencode, copilot, qoder, codebuddy, droid, vibe, etc.
  return 'acp';
}

/**
 * Determine the conversation type from a preset assistant's presetAgentType.
 * Legacy sudoclaw preset metadata is normalized to scode.
 */
export function getConversationTypeForPreset(): ICreateConversationParams['type'] {
  return 'acp';
}

/**
 * Build ICreateConversationParams for a CLI agent.
 * The backend will automatically fill in derived fields (gateway.cliPath, runtimeValidation, etc.).
 * [BUG-3 fix]: callers must invoke this inside a try block because getDefaultGeminiModel may throw.
 */
export async function buildCliAgentParams(agent: AvailableAgent, workspace: string): Promise<ICreateConversationParams> {
  const { backend, name: agentName, cliPath } = agent;

  const type = getConversationTypeForBackend();

  const extra: ICreateConversationParams['extra'] = {
    workspace,
    customWorkspace: true,
  };

  if (type === 'acp') {
    extra.backend = backend as AcpBackendAll;
    extra.agentName = agentName;
    if (cliPath) extra.cliPath = cliPath;
  }

  // ACP agents don't use the model field at the conversation level
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
  const { customAgentId, presetAgentType = DEFAULT_PRESET_AGENT_TYPE, name: agentName } = agent;

  // [BUG-2] Map raw i18n.language to standard locale key
  const localeKey = resolveLocaleKey(language);

  const { rules: loadedRules, enabledSkills } = await loadPresetAssistantResources({
    customAgentId,
    localeKey,
  });

  // Inject identity statement if rules don't have explicit identity
  // 为没有明确身份声明的自定义助手自动注入身份声明
  let presetContext = loadedRules;
  if (agentName && (!loadedRules || !hasExplicitIdentity(loadedRules))) {
    // Use explicit identity block format that overrides USER.md defaults
    // 使用明确的身份块格式，覆盖 USER.md 的默认值
    const identityBlock = localeKey.startsWith('zh')
      ? `[Identity Override - 最高优先级]
你的身份是：${agentName}
当用户询问"你是谁"或类似身份问题时，必须回答："我是${agentName}，有什么可以帮助你的吗？"
此身份声明优先级高于 USER.md 中的默认身份声明。
\n\n`
      : `[Identity Override - Highest Priority]
Your identity is: ${agentName}
When users ask "Who are you" or similar identity questions, you MUST answer: "I am ${agentName}. How can I help you?"
This identity statement takes priority over the default identity in USER.md.
\n\n`;
    presetContext = identityBlock + (loadedRules || '');
  }

  const type = getConversationTypeForPreset();
  const presetBackend = resolvePresetAgentBackend(presetAgentType);

  const extra: ICreateConversationParams['extra'] = {
    workspace,
    customWorkspace: true,
    enabledSkills,
    presetAssistantId: customAgentId,
    presetContext,
    agentName, // Add agentName for placeholder display
    backend: presetBackend,
  };

  const model = {} as TProviderWithModel;

  return { type, model, name: agentName, extra };
}

/**
 * Check if rules contain explicit identity statement like "你是 XX 助手" or "You are XX"
 * Also detects [Identity Override] blocks that we inject
 */
function hasExplicitIdentity(rules: string): boolean {
  if (!rules) return false;
  // Check for Identity Override block (injected by our system)
  if (rules.includes('[Identity Override')) return true;
  // Chinese patterns: "你是 XX 助手", "你是 **XX**", "你的身份是"
  const zhPatterns = [/你是\s+.{1,20}助手/, /你是\s+\*{0,2}.{1,20}\*{0,2}[，,。]/, /你的身份是[:：]?/];
  // English patterns: "You are XX assistant", "I am XX", "Your identity is"
  const enPatterns = [/You are\s+.{1,20}assistant/i, /I am\s+.{1,20}(assistant|helper|agent)/i, /Your identity is[::]?/i];
  return zhPatterns.some((p) => p.test(rules)) || enPatterns.some((p) => p.test(rules));
}
