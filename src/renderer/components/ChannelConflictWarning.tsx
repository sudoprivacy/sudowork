/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Link, Space, Typography } from '@arco-design/web-react';
import { IconExclamationCircle } from '@arco-design/web-react/icon';
import React from 'react';

const { Paragraph, Text } = Typography;

interface ChannelConflictWarningProps {
  platform: 'lark' | 'telegram';
  sudoclawConfigPath: string;
  onDisableSudoclaw?: () => void;
  onIgnore?: () => void;
}

/**
 * Warning component when Sudoclaw channel conflicts with Sudowork Channels
 */
export const ChannelConflictWarning: React.FC<ChannelConflictWarningProps> = ({ platform, sudoclawConfigPath, onDisableSudoclaw, onIgnore }) => {
  const platformName = platform === 'lark' ? 'Lark/Feishu' : 'Telegram';
  const channelKey = platform === 'lark' ? 'feishu' : 'telegram';

  return (
    <Alert
      type='warning'
      icon={<IconExclamationCircle />}
      title={`${platformName} Channel Conflict Detected`}
      content={
        <Space direction='vertical' size='medium' style={{ width: '100%' }}>
          <Paragraph>
            <Text bold>Sudoclaw is handling {platformName} messages, not Sudowork.</Text>
          </Paragraph>

          <Paragraph>
            Your {platformName} bot credentials are also configured in Sudoclaw. This means:
            <ul>
              <li>
                <Text type='error'>✗ Switching agents in Sudowork will have no effect</Text>
              </li>
              <li>
                <Text type='error'>✗ Messages are processed by Sudoclaw's agent</Text>
              </li>
              <li>
                <Text type='success'>✓ Messages still work (via Sudoclaw)</Text>
              </li>
            </ul>
          </Paragraph>

          <Paragraph>
            <Text bold>To use Sudowork Channels and switch agents:</Text>
          </Paragraph>

          <Paragraph>
            <Text type='secondary'>Option 1: Disable Sudoclaw {platformName} (Recommended)</Text>
            <br />
            Edit: <Text code>{sudoclawConfigPath}</Text>
            <br />
            Set: <Text code>{`channels.${channelKey}.enabled = false`}</Text>
            <br />
            Then restart Sudoclaw and Sudowork.
          </Paragraph>

          <Paragraph>
            <Text type='secondary'>Option 2: Use a different bot</Text>
            <br />
            Create a new {platformName} bot with different credentials for Sudowork.
          </Paragraph>

          <Paragraph>
            <Text type='secondary'>Option 3: Keep using Sudoclaw</Text>
            <br />
            Disable {platformName} in Sudowork Channels and continue using Sudoclaw's integration.
          </Paragraph>

          <Space>
            {onDisableSudoclaw && (
              <Button type='primary' onClick={onDisableSudoclaw}>
                Help me disable Sudoclaw {platformName}
              </Button>
            )}
            {onIgnore && (
              <Button type='text' onClick={onIgnore}>
                Ignore (I know what I'm doing)
              </Button>
            )}
          </Space>
        </Space>
      }
      closable={false}
      style={{ marginBottom: 16 }}
    />
  );
};

/**
 * Compact warning banner (for settings page)
 */
export const ChannelConflictBanner: React.FC<{ platform: 'lark' | 'telegram'; onLearnMore: () => void }> = ({ platform, onLearnMore }) => {
  const platformName = platform === 'lark' ? 'Lark/Feishu' : 'Telegram';

  return (
    <Alert
      type='warning'
      content={
        <Space>
          <Text>⚠️ Sudoclaw {platformName} conflict detected - Agent switching won't work.</Text>
          <Link onClick={onLearnMore}>Learn more</Link>
        </Space>
      }
      closable
      style={{ marginBottom: 12 }}
    />
  );
};
