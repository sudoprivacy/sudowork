/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Message } from '@arco-design/web-react';
import { IconDown, IconLoading } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moss } from '@/common/ipcBridge';
import PreferenceRow from './PreferenceRow';

/**
 * Default agent (智能体) picker for an IM channel in ENTERPRISE mode.
 *
 * Standalone mode keeps its own per-platform picker backed by local ConfigStorage. In
 * enterprise mode the channel runs on the moss server, which spawns sessions from
 * channel_plugins.config_json — so this reads and writes moss directly. Pointing it at
 * local config instead would create two sources of truth and silently not affect the
 * sessions moss actually creates.
 *
 * Only the default for NEW chats is set here. A chat that was switched with /agent keeps
 * its own agent, because one connection serves many chats (several groups plus DMs) and
 * each holds its own session.
 */
interface EnterpriseAgentSelectorProps {
  /** Channel plugin id, e.g. "wecom_default". */
  pluginId: string;
  /** Hide entirely until the channel is configured — there is no row to write to yet. */
  enabled: boolean;
}

const NONE_KEY = '__none__';

const EnterpriseAgentSelector: React.FC<EnterpriseAgentSelectorProps> = ({ pluginId, enabled }) => {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Array<{ name: string; displayName: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await moss.getChannelAgents.invoke({ pluginId });
      if (res.success && res.data) {
        setAgents(res.data.agents);
        setSelected(res.data.defaultAgent);
      }
    } catch (error) {
      console.warn('[EnterpriseAgentSelector] failed to load agents:', error);
    } finally {
      setLoading(false);
    }
  }, [pluginId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelect = async (agentName: string | null) => {
    if (agentName === selected) return;
    const previous = selected;
    setSelected(agentName);
    setSaving(true);
    try {
      const res = await moss.setChannelDefaultAgent.invoke({ pluginId, agentName });
      if (!res.success) throw new Error(res.msg || 'save failed');
      Message.success(t('settings.channels.agentSaved', '默认智能体已更新'));
    } catch (error) {
      // Roll back so the control never shows a value the server did not accept.
      setSelected(previous);
      Message.error(error instanceof Error ? error.message : t('common.saveFailed', 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) return null;

  const noneLabel = t('settings.channels.agentNone', '未指定（通用会话）');
  const currentLabel = selected ? (agents.find((a) => a.name === selected)?.displayName ?? selected) : noneLabel;

  return (
    <PreferenceRow
      label={t('settings.channels.defaultAgent', '默认智能体')}
      description={t(
        'settings.channels.defaultAgentDesc',
        '新会话将使用该智能体；已有会话保持各自在聊天中切换的结果。用户可在聊天中发送 /agents 查看、/agent <名称> 切换。',
      )}
    >
      <Dropdown
        trigger='click'
        position='br'
        droplist={
          <Menu selectedKeys={[selected ?? NONE_KEY]}>
            <Menu.Item key={NONE_KEY} onClick={() => void handleSelect(null)}>
              {noneLabel}
            </Menu.Item>
            {agents.map((a) => (
              <Menu.Item key={a.name} onClick={() => void handleSelect(a.name)}>
                {a.displayName}
              </Menu.Item>
            ))}
          </Menu>
        }
      >
        <Button
          type='secondary'
          className='min-w-40'
          disabled={saving || loading}
          icon={saving || loading ? <IconLoading style={{ fontSize: 14 }} /> : <IconDown style={{ fontSize: 14 }} />}
        >
          {currentLabel}
        </Button>
      </Dropdown>
    </PreferenceRow>
  );
};

export default EnterpriseAgentSelector;
