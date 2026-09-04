/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolvePresetAgentBackend } from '@sudowork/common/acpTypes';
import type { AcpBackendAll, AcpBackendConfig } from '@sudowork/common/acpTypes';
import type { AvailableAgent } from '../types';

export function resolveGuidModelBackendKey({ isEnterprise, sessionMode, selectedAgentKey, selectedAgentInfo, customAgents }: IResolveGuidModelBackendKeyOptions): AcpBackendAll {
  if (isEnterprise) {
    return sessionMode === 'remote' ? 'remote-agent' : 'scode';
  }

  if (!selectedAgentKey.startsWith('custom:')) {
    return selectedAgentKey as AcpBackendAll;
  }

  const customAgentId = selectedAgentInfo?.customAgentId || selectedAgentKey.slice(7);
  const customAgent = customAgents.find((agent) => agent.id === customAgentId);
  return resolvePresetAgentBackend(customAgent?.presetAgentType || selectedAgentInfo?.presetAgentType);
}

interface IResolveGuidModelBackendKeyOptions {
  isEnterprise: boolean;
  sessionMode: 'remote' | 'local';
  selectedAgentKey: string;
  selectedAgentInfo: AvailableAgent | undefined;
  customAgents: AcpBackendConfig[];
}
