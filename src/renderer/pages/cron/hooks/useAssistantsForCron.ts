import { useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import { fetchAssistantsAsConfigs } from '@/renderer/shared/agents/assistantAdapter';
import type { AcpBackendConfig } from '@/types/acpTypes';

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
