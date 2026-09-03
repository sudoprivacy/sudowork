/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { AcpBackendConfig } from '@sudowork/common/acpTypes';
import { fetchAssistantsAsConfigs } from '@/renderer/shared/agents/assistantAdapter';

export function useAssistantsForCron(): AcpBackendConfig[] {
  const [assistants, setAssistants] = useState<AcpBackendConfig[]>([]);

  useEffect(() => {
    Promise.all([fetchAssistantsAsConfigs(), ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[])])
      .then(([local, ext]) => {
        const merged: AcpBackendConfig[] = [...local, ...((ext as unknown as AcpBackendConfig[]) || [])];
        setAssistants(merged.filter((assistant) => assistant.enabled !== false));
      })
      .catch(() => {});
  }, []);

  return assistants;
}
