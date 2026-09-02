/**
 * @license
 * Copyright 2026 SudoPrivacy
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
  const meta = info.meta || {};
  // Always use directory name (info.name) as id for consistent lookup
  const id = info.isBuiltin ? `builtin-${info.name}` : info.name;
  // isPreset = builtin or hub-installed (NOT user-created custom assistants)
  const isPreset = info.isBuiltin || info.isHubInstalled;
  return {
    id,
    name: meta.nameI18n?.['zh-CN'] || meta.nameI18n?.['en-US'] || meta.display_name || meta.name || meta.id || info.name,
    nameI18n: meta.nameI18n,
    descriptionI18n: meta.descriptionI18n,
    avatar: meta.avatar,
    enabled: info.enabled,
    isPreset,
    presetAgentType: meta.presetAgentType,
    promptsI18n: meta.promptsI18n,
    enabledSkills: meta.enabledSkills ?? meta.defaultEnabledSkills,
    isBuiltin: info.isBuiltin,
    apiKeyFields: meta.apiKeyFields,
    defaultInitPrompt: meta.defaultInitPrompt,
  };
}

/** Fetch all installed assistants and convert to AcpBackendConfig[]. */
export async function fetchAssistantsAsConfigs(): Promise<AcpBackendConfig[]> {
  const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
  if (!result?.data) return [];
  return result.data.map(toBackendConfig);
}

/**
 * Variant that asks the main process to additionally filter the list against
 * sudowork-server's `/agents/visible`. Hub/tenant assistants the current user
 * is not allowed to see (per `assistant_acl`) are dropped before mapping.
 *
 * The token is read from localStorage at the call site so we don't tie this
 * helper to any React context. Pass `null` (or an empty string) when not
 * logged in — the main process falls back to the unfiltered list.
 */
export async function fetchVisibleAssistantsAsConfigs(accessToken: string | null): Promise<AcpBackendConfig[]> {
  if (!accessToken) {
    return fetchAssistantsAsConfigs();
  }
  const result = await ipcBridge.assistantHub.getInstalledAssistantsWithVisibility.invoke({
    accessToken,
  });
  if (!result?.data) return [];
  return result.data.map(toBackendConfig);
}

/** Resolve the lookup name for an assistant from its AcpBackendConfig id. */
export function resolveAssistantName(configId: string): string {
  return configId.startsWith('builtin-') ? configId.slice('builtin-'.length) : configId;
}
