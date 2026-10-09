/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { AcpBackendConfig } from '@sudowork/common/acpTypes';
import { fetchAssistantsAsConfigs } from '@renderer/shared/agents/assistantAdapter';

export function useAssistantsForCron(sessionMode: 'local' | 'remote' = 'local'): AcpBackendConfig[] {
  const [assistants, setAssistants] = useState<AcpBackendConfig[]>([]);

  useEffect(() => {
    let isCancelled = false;
    setAssistants([]);
    if (sessionMode === 'remote') {
      void ipcBridge.eeclaw.getCloudAssistants
        .invoke()
        .then((result) => {
          if (!isCancelled && result?.success) {
            setAssistants((result.data || []).map((item) => ({ id: item.key, name: item.name, avatar: item.avatar, enabled: true, presetAgentType: 'remote-agent' })));
          }
        })
        .catch(() => {});
      return () => {
        isCancelled = true;
      };
    }
    Promise.all([fetchAssistantsAsConfigs(), ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[])])
      .then(([local, ext]) => {
        const merged: AcpBackendConfig[] = [...local, ...((ext as unknown as AcpBackendConfig[]) || [])];
        if (!isCancelled) setAssistants(merged.filter((assistant) => assistant.enabled !== false));
      })
      .catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, [sessionMode]);

  return assistants;
}
