/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AssistantCategory } from '@/process/AssistantManager';
import type { IAssistantHubSkill } from '@/common/ipcBridge';
import type { AcpBackendConfig } from '@/types/acpTypes';

export type AssistantListItem = AcpBackendConfig & {
  _source?: string;
  _extensionName?: string;
  _kind?: string;
  _category?: AssistantCategory;
  _isHubInstalled?: boolean;
  _hubId?: string;
  _installedVersion?: string;
  _hubMeta?: IAssistantHubSkill;
};
