/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Avatar, Button, Card, List, Message, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { useState } from 'react';
import { useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IAssignedAssistants {
  items: Array<{
    assistant_id: string;
    name: string;
    display_name: string;
    description: string | null;
    emoji: string | null;
  }>;
}

export default function EnterpriseAssistantPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isStarting, setIsStarting] = useState(false);
  const { data, loading, error } = useParkQuery<IAssignedAssistants>('getEnterpriseAssistants');

  async function startConsultation(assistantId: string, displayName: string) {
    setIsStarting(true);
    try {
      // 走现有会话创建链路：adapter 从 extra.presetAssistantId 取助手引用
      // （BFF assertSelectionVisible 的 park 放行分支在此生效；moss 侧
      // assertParkAssistantAllowed 为权威校验）。
      const conversation = await ipcBridge.conversation.create.invoke({
        type: 'remote-agent',
        model: { providerId: 'moss', modelId: 'default' } as never,
        extra: { presetAssistantId: assistantId, agentName: displayName },
      });
      if (conversation && typeof conversation === 'object' && !('__error' in conversation) && 'id' in conversation) {
        navigate(`/conversation/${String((conversation as { id: string }).id)}`);
      }
    } catch (err) {
      Message.error(err instanceof Error ? err.message : t('park.leads.updateFailed', '操作失败'));
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <PageWrapper title={t('park.assistant.title', '园区咨询助手')}>
      <Card loading={loading}>
        {error ? (
          <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
        ) : (data?.items ?? []).length === 0 ? (
          <Typography.Text type='secondary'>{t('park.assistant.noAssistant', '暂未分配园区咨询助手，请联系园区运营')}</Typography.Text>
        ) : (
          <List
            dataSource={data?.items ?? []}
            render={(item) => (
              <List.Item
                key={item.assistant_id}
                actions={[
                  <Button key='start' type='primary' size='small' loading={isStarting} onClick={() => void startConsultation(item.assistant_id, item.display_name)}>
                    {t('park.assistant.startSession', '开始咨询')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<Avatar size={36}>{item.emoji ?? '🤖'}</Avatar>}
                  title={item.display_name}
                  description={item.description ?? item.name}
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </PageWrapper>
  );
}
