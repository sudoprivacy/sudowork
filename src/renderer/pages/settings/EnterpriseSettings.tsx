/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Enterprise (eeclaw) settings page
 * Shows organization info, agent config, and sync status
 */

import { Button, Card, Descriptions, Switch, Typography } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { EeclawAgentConfig, EeclawUserInfo } from '@/common/types/eeclawTypes';

const { Text } = Typography;

interface SyncStatus {
  conversations?: number;
  skills?: number;
  assistants?: number;
}

export default function EnterpriseSettings() {
  const [userInfo, setUserInfo] = useState<EeclawUserInfo | null>(null);
  const [agentConfig, setAgentConfig] = useState<EeclawAgentConfig | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      ipcBridge.eeclaw.getServerConfig.invoke(),
    ]).then(([configRes]) => {
      if (configRes.success && configRes.data) {
        setAgentConfig(configRes.data);
      }
      setLoading(false);
    });
  }, []);

  const handleSync = () => {
    void ipcBridge.eeclaw.syncAll.invoke().then((res) => {
      if (res.success) {
        setSyncStatus({
          conversations: Date.now(),
          skills: Date.now(),
          assistants: Date.now(),
        });
      }
    });
  };

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title heading={6}>Enterprise Settings</Typography.Title>

      <Card title="Organization" style={{ marginBottom: 16 }}>
        <Descriptions
          data={[
            { label: 'Mode', value: 'Enterprise', span: 2 },
            { label: 'Server', value: 'Not configured', span: 2 },
          ]}
          column={2}
        />
      </Card>

      <Card title="Agent Configuration" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text>Remote Agent (Server-side)</Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Server-hosted Claude Code instance
              </Text>
            </div>
            <Switch checked={agentConfig?.remoteAgentEnabled} disabled />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text>Local Agent</Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Allow local CLI agent usage (requires server permission)
              </Text>
            </div>
            <Switch
              checked={agentConfig?.localAgentEnabled}
              disabled={!agentConfig?.localAgentEnabled}
            />
          </div>
        </div>
      </Card>

      <Card title="Sync Status">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text>Conversations</Text>
            <Text type="secondary">{formatTime(syncStatus?.conversations)}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text>Skills</Text>
            <Text type="secondary">{formatTime(syncStatus?.skills)}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text>Assistants</Text>
            <Text type="secondary">{formatTime(syncStatus?.assistants)}</Text>
          </div>
          <Button type="primary" onClick={handleSync} loading={loading} style={{ marginTop: 8 }}>
            Sync Now
          </Button>
        </div>
      </Card>
    </div>
  );
}
