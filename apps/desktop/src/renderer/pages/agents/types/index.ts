/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IAssistantHubSkill } from '@sudowork/host-bridge/ipcBridge';
import type { AssistantCategory } from '@/process/AssistantManager';
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
  _uploaded?: boolean;
  _publishStatus?: 'pending' | 'approved' | 'rejected';
};

export type AssistantLatestVersion = {
  version: string;
  sourceUrl: string;
  checksum: string;
  fetchedAt: number;
};
