import { Alert, Button, Card, Empty, Input, Message, Modal, Radio, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { getAgentExecutionType, type AgentExecutionType } from '@sudowork/common/personalAgents';
import { emitter } from '@renderer/utils/emitter';
import { useAgentEntry } from '@renderer/pages/conversation/hooks/useAgentEntry';
import { useConversationHistory } from '@renderer/pages/conversation/context/ConversationHistoryContext';
import { resetGuidDraft } from '@renderer/pages/guid/hooks/useGuidDraft';
import { isWebBridgeAvailable } from '@renderer/utils/platform';

export default function MyAgents() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openingReference, onOpenAgent } = useAgentEntry();
  const { agents: listedAgents, isAgentsLoading: isLoading, isAgentsLoadFailed: isLoadFailed, refresh: onLoad } = useConversationHistory();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [executionType, setExecutionType] = useState<AgentExecutionType>('server');
  const [activeFilter, setActiveFilter] = useState<AgentFilter>('all');
  const isLocalCreationAvailable = !isWebBridgeAvailable();
  const isNameValid = name.trim().length > 0 && name.trim().length <= 60;
  const agents = listedAgents.filter((agent) => agent.kind !== 'template').filter((agent) => activeFilter === 'all' || getAgentExecutionType(agent) === activeFilter);

  async function onCreate() {
    if (!isNameValid || isCreating) return;
    setIsCreating(true);
    try {
      const result = await ipcBridge.eeclaw.createUserAgent.invoke({ displayName: name.trim(), executionType });
      if (!result.success || !result.data) throw new Error('Agent creation failed');
      setIsCreateOpen(false);
      setName('');
      setExecutionType('server');
      emitter.emit('chat.history.refresh');
    } catch {
      Message.error(t('agent.mine.createFailed'));
    } finally {
      setIsCreating(false);
    }
  }

  function onCloseCreate(): void {
    if (isCreating) return;
    setIsCreateOpen(false);
    setName('');
    setExecutionType('server');
  }

  function onOpenCreate(): void {
    setExecutionType('server');
    setIsCreateOpen(true);
  }

  function getExecutionTypeLabel(type: AgentExecutionType): string {
    return t(type === 'local' ? 'agent.mine.localExecution' : 'agent.mine.serverExecution');
  }

  return (
    <div className='flex-1 min-h-0 overflow-y-auto p-4'>
      <div className='flex items-center justify-between gap-3 mb-4'>
        <Typography.Title heading={4} style={{ margin: 0 }}>
          {t('agent.mine.title')}
        </Typography.Title>
        <Button type='primary' disabled={isLoading || isLoadFailed} onClick={onOpenCreate}>
          {t('agent.mine.create')}
        </Button>
      </div>
      <Typography.Paragraph type='secondary'>{t('agent.mine.description')}</Typography.Paragraph>
      <Radio.Group
        type='button'
        value={activeFilter}
        onChange={(value) => {
          if (value === 'all' || value === 'local' || value === 'server') setActiveFilter(value);
        }}
        options={[{ label: t('agent.mine.filterAll'), value: 'all' }, { label: t('agent.mine.filterServer'), value: 'server' }, ...(isLocalCreationAvailable ? [{ label: t('agent.mine.filterLocal'), value: 'local' }] : [])]}
        className='mb-4'
      />
      {isLoadFailed && <Alert type='error' content={t('agent.mine.loadFailed')} action={<Button onClick={() => void onLoad()}>{t('agent.mine.retry')}</Button>} />}
      <Spin loading={isLoading} className='w-full'>
        <Space direction='vertical' size='medium' className='w-full'>
          {agents.map((agent) => (
            <Card
              key={agent.ref}
              title={agent.displayName}
              extra={
                <Space size='small'>
                  <Tag>{t(agent.kind === 'default' ? 'agent.mine.default' : 'agent.mine.personal')}</Tag>
                  <Tag color={getAgentExecutionType(agent) === 'local' ? 'blue' : 'orange'}>{getExecutionTypeLabel(getAgentExecutionType(agent))}</Tag>
                </Space>
              }
            >
              <Space>
                <Button type='primary' aria-label={`${t('agent.mine.open')} ${agent.displayName}`} loading={openingReference === agent.ref} disabled={openingReference !== null} onClick={() => void onOpenAgent(agent.ref, undefined, getAgentExecutionType(agent))}>
                  {t('agent.mine.open')}
                </Button>
                <Button
                  onClick={() => {
                    resetGuidDraft();
                    const mode = getAgentExecutionType(agent) === 'local' ? 'local' : 'remote';
                    void navigate(`/guid?assistant=${encodeURIComponent(agent.ref)}&mode=${mode}`);
                  }}
                >
                  {t('agent.mine.startConversation')}
                </Button>
              </Space>
            </Card>
          ))}
          {!isLoading && !isLoadFailed && agents.length === 0 && <Empty description={t('agent.mine.empty')} />}
        </Space>
      </Spin>
      <Modal title={t('agent.mine.create')} visible={isCreateOpen} confirmLoading={isCreating} okButtonProps={{ disabled: !isNameValid }} onOk={() => void onCreate()} onCancel={onCloseCreate}>
        <Input aria-label={t('agent.mine.name')} placeholder={t('agent.mine.name')} maxLength={60} value={name} onChange={setName} onPressEnter={() => void onCreate()} />
        <div className='mt-4 flex flex-col gap-2'>
          <Typography.Text>{t('agent.mine.executionType')}</Typography.Text>
          <Radio.Group value={executionType} onChange={(value) => (value === 'local' || value === 'server' ? setExecutionType(value) : undefined)}>
            <Radio value='server'>{t('agent.mine.serverExecution')}</Radio>
            {isLocalCreationAvailable && <Radio value='local'>{t('agent.mine.localExecution')}</Radio>}
          </Radio.Group>
        </div>
      </Modal>
    </div>
  );
}

type AgentFilter = 'all' | AgentExecutionType;
