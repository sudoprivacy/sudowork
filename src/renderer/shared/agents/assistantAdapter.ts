/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Adapter: IAssistantInfo (filesystem SSOT) → AcpBackendConfig (renderer compat).
 *
 * Renderer code still uses AcpBackendConfig for state/props.
 * This adapter bridges the new IPC data source to the existing renderer types.
 */

import { ipcBridge } from '@/common';
import type { IAssistantInfo } from '@/process/AssistantManager';
import type { AcpBackendConfig } from '@/types/acpTypes';

/** Convert a single IAssistantInfo to AcpBackendConfig for renderer consumption. */
export function toBackendConfig(info: IAssistantInfo): AcpBackendConfig {
  const meta = info.meta;
  const id = info.isBuiltin ? `builtin-${meta.id || info.name}` : (meta.id || info.name);
  return {
    id,
    name: meta.nameI18n?.['zh-CN'] || meta.nameI18n?.['en-US'] || meta.id || info.name,
    nameI18n: meta.nameI18n,
    descriptionI18n: meta.descriptionI18n,
    avatar: meta.avatar,
    enabled: info.enabled,
    isPreset: true,
    presetAgentType: meta.presetAgentType,
    promptsI18n: meta.promptsI18n,
    enabledSkills: meta.enabledSkills ?? meta.defaultEnabledSkills,
    isBuiltin: info.isBuiltin,
    apiKeyFields: meta.apiKeyFields,
  };
}

/** Fetch all installed assistants and convert to AcpBackendConfig[]. */
export async function fetchAssistantsAsConfigs(): Promise<AcpBackendConfig[]> {
  const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
  if (!result?.data) return [];
  return result.data.map(toBackendConfig);
}

/** Resolve the lookup name for an assistant from its AcpBackendConfig id. */
export function resolveAssistantName(configId: string): string {
  return configId.startsWith('builtin-') ? configId.slice('builtin-'.length) : configId;
}
