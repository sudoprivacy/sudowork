/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import { iconColors } from '@/renderer/theme/colors';
import { Button, Tooltip } from '@arco-design/web-react';
import { Connection } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAddEventListener } from '@/renderer/utils/emitter';

const DOT_COLORS: Record<string, string> = {
  connecting: '#165dff',
  connected: '#00b42a',
  authenticated: '#00b42a',
  session_active: '#00b42a',
  disconnected: '#ff7d00',
  error: '#f53f3f',
};

const STATUS_LABELS: Record<string, string> = {
  connecting: 'agentStatus.connecting',
  connected: 'agentStatus.connected',
  authenticated: 'agentStatus.authenticated',
  session_active: 'agentStatus.session_active',
  disconnected: 'agentStatus.disconnected',
  error: 'agentStatus.error',
};

function resolveGatewayHealthStatus(gatewayRunning: boolean): string {
  return gatewayRunning ? 'connected' : 'disconnected';
}

const AgentStatusDot: React.FC<{ conversation_id: string; conversationType?: TChatConversation['type'] }> = ({ conversation_id, conversationType }) => {
  const [status, setStatus] = useState('');
  const { t } = useTranslation();

  useEffect(() => {
    setStatus('');
    if (conversationType === 'openclaw-gateway') {
      let disposed = false;

      const syncGatewayStatus = () => {
        void ipcBridge.openclawConversation.getGatewayStatus
          .invoke()
          .then((res) => {
            if (disposed || !res?.success || !res.data) return;
            setStatus(resolveGatewayHealthStatus(!!res.data.gatewayRunning));
          })
          .catch(() => {});
      };

      syncGatewayStatus();
      const timer = window.setInterval(syncGatewayStatus, 5000);
      return () => {
        disposed = true;
        window.clearInterval(timer);
      };
    }

    void ipcBridge.conversation.getConnectionStatus
      .invoke({ conversation_id })
      .then((res) => {
        if (res?.success && res.data?.status) {
          setStatus(res.data.status);
        }
      })
      .catch(() => {});
  }, [conversation_id, conversationType]);

  useAddEventListener(
    'agent.connection.status',
    (convId: string, newStatus: string) => {
      if (conversationType === 'openclaw-gateway') {
        return;
      }
      if (convId === conversation_id) {
        setStatus(newStatus);
      }
    },
    [conversation_id, conversationType]
  );

  if (!status) return null;

  const dotColor = DOT_COLORS[status] || '#86909c';
  const labelKey = STATUS_LABELS[status] || 'agentStatus.unknown';

  return (
    <Tooltip content={t(labelKey, { defaultValue: status })}>
      <Button type='text' size='small' className='!h-auto !w-auto !min-w-0 !px-0 !py-0 cursor-default'>
        <span className='inline-flex items-center gap-2px rounded-full px-8px py-2px bg-2'>
          <Connection theme='outline' size={16} fill={iconColors.primary} />
          <span className='ml-4px w-8px h-8px rounded-full' style={{ backgroundColor: dotColor }} />
        </span>
      </Button>
    </Tooltip>
  );
};

export default AgentStatusDot;
