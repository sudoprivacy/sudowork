import { Alert, Button, Card, Empty, Input, Message, Modal, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { IMyAgent } from '@sudowork/common/personalAgents';
import { emitter } from '@renderer/utils/emitter';

export default function MyAgents() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<IMyAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadFailed, setIsLoadFailed] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const isNameValid = name.trim().length > 0 && name.trim().length <= 60;

  const onLoad = useCallback(async () => {
    setIsLoading(true);
    setIsLoadFailed(false);
    try {
      const result = await ipcBridge.eeclaw.getMyAgents.invoke();
      if (!result.success || !Array.isArray(result.data)) throw new Error('Agent list unavailable');
      setAgents(result.data.filter((agent) => agent.kind !== 'template'));
    } catch {
      setAgents([]);
      setIsLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void onLoad(); }, [onLoad]);

  async function onCreate() {
    if (!isNameValid || isCreating) return;
    setIsCreating(true);
    try {
      const result = await ipcBridge.eeclaw.createUserAgent.invoke({ displayName: name.trim() });
      if (!result.success || !result.data) throw new Error('Agent creation failed');
      setIsCreateOpen(false);
      setName('');
      emitter.emit('chat.history.refresh');
      await onLoad();
    } catch {
      Message.error(t('agent.mine.createFailed'));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className='flex-1 min-h-0 overflow-y-auto p-4'>
      <div className='flex items-center justify-between gap-3 mb-4'>
        <Typography.Title heading={4} style={{ margin: 0 }}>{t('agent.mine.title')}</Typography.Title>
        <Button type='primary' disabled={isLoading || isLoadFailed} onClick={() => setIsCreateOpen(true)}>{t('agent.mine.create')}</Button>
      </div>
      <Typography.Paragraph type='secondary'>{t('agent.mine.description')}</Typography.Paragraph>
      {isLoadFailed && <Alert type='error' content={t('agent.mine.loadFailed')} action={<Button onClick={() => void onLoad()}>{t('agent.mine.retry')}</Button>} />}
      <Spin loading={isLoading} className='w-full'>
        <Space direction='vertical' size='medium' className='w-full'>
          {agents.map((agent) => (
            <Card key={agent.ref} title={agent.displayName} extra={<Tag>{t(agent.kind === 'default' ? 'agent.mine.default' : 'agent.mine.personal')}</Tag>}>
              <Button onClick={() => void navigate(`/guid?assistant=${encodeURIComponent(agent.ref)}`)}>{t('agent.mine.startConversation')}</Button>
            </Card>
          ))}
          {!isLoading && !isLoadFailed && agents.length === 0 && <Empty description={t('agent.mine.empty')} />}
        </Space>
      </Spin>
      <Modal title={t('agent.mine.create')} visible={isCreateOpen} confirmLoading={isCreating} okButtonProps={{ disabled: !isNameValid }} onOk={() => void onCreate()} onCancel={() => { if (!isCreating) { setIsCreateOpen(false); setName(''); } }}>
        <Input aria-label={t('agent.mine.name')} placeholder={t('agent.mine.name')} maxLength={60} value={name} onChange={setName} onPressEnter={() => void onCreate()} />
      </Modal>
    </div>
  );
}
