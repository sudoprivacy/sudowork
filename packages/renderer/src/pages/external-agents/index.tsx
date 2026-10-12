import ExternalAgentManagement from './ExternalAgentManagement';
import { Alert, Button, Card, Drawer, Empty, Input, Select, Space, Tag, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { CreateExternalTask, ExternalAgent, ExternalSession, ExternalTask, ExternalProviderAccess } from '@sudowork/contracts/external-provider';

const isFinished = (task: ExternalTask) => ['succeeded', 'failed', 'rejected', 'unknown'].includes(task.status);

export default function ExternalAgents() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const sessionId = search.get('session') ?? '';
  const [access, setAccess] = useState<ExternalProviderAccess | null>(null);
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  useEffect(() => {
    let isCancelled = false;
    void ipcBridge.externalProviders.access
      .invoke()
      .then((response) => {
        if (!isCancelled && response.success && response.data) setAccess(response.data);
      })
      .catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, []);
  const [agents, setAgents] = useState<ExternalAgent[]>([]);
  const [sessions, setSessions] = useState<ExternalSession[]>([]);
  const [tasks, setTasks] = useState<ExternalTask[]>([]);
  const [agentId, setAgentId] = useState('');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isLoadFailed, setIsLoadFailed] = useState(false);
  const [isPollFailed, setIsPollFailed] = useState(false);
  const [pending, setPending] = useState<CreateExternalTask | null>(null);
  const [pollGeneration, setPollGeneration] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  const session = sessions.find((item) => item.id === sessionId);
  const selectedAgentId = session?.agent_id ?? agentId;
  const activeTask = tasks.find((item) => !isFinished(item));
  const isUnknown = tasks.some((item) => item.status === 'unknown');
  const isBusy = isSending || isLoading || Boolean(activeTask) || isUnknown || Boolean(session?.active_task_id);

  const onLoadLists = useCallback(async () => {
    const [agentResponse, sessionResponse] = await Promise.all([ipcBridge.externalProviders.agents.invoke(), ipcBridge.externalProviders.sessions.invoke()]);
    if (!agentResponse.success || !agentResponse.data || !sessionResponse.success || !sessionResponse.data) throw new Error('External agents unavailable');
    if (!mounted.current) return;
    setAgents(agentResponse.data);
    setSessions(sessionResponse.data);
    setAgentId((current) => current || agentResponse.data?.[0]?.id || '');
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    setIsLoading(true);
    setIsLoadFailed(false);
    setTasks([]);
    void (async () => {
      await onLoadLists();
      if (sessionId) {
        const response = await ipcBridge.externalProviders.history.invoke({ sessionId });
        if (!response.success || !response.data) throw new Error('History unavailable');
        if (generation.current === current) setTasks(response.data);
      }
    })()
      .catch(() => {
        if (generation.current === current) setIsLoadFailed(true);
      })
      .finally(() => {
        if (generation.current === current) setIsLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [sessionId, onLoadLists, pollGeneration]);

  const activeTaskId = activeTask?.id;
  useEffect(() => {
    if (!activeTaskId) return;
    let isCancelled = false;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    setIsPollFailed(false);
    const onPoll = async () => {
      try {
        const response = await ipcBridge.externalProviders.events.invoke({ taskId: activeTaskId, cursor });
        if (isCancelled) return;
        if (!response.success || !response.data) throw new Error('Task events unavailable');
        const page = response.data;
        cursor = page.next_cursor;
        setTasks((current) => current.map((item) => (item.id === page.task.id ? page.task : item)));
        if (isFinished(page.task)) {
          await onLoadLists();
          return;
        }
        timer = setTimeout(() => void onPoll(), 750);
      } catch {
        if (!isCancelled) setIsPollFailed(true);
      }
    };
    void onPoll();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [activeTaskId, onLoadLists, pollGeneration]);

  async function onSend() {
    if (isSending || (!pending && (isBusy || !selectedAgentId || !query.trim()))) return;
    const request = pending ?? { agent_id: selectedAgentId, ...(sessionId ? { session_id: sessionId } : {}), query: query.trim(), idempotency_key: crypto.randomUUID() };
    setPending(request);
    setIsSending(true);
    try {
      const response = await ipcBridge.externalProviders.create.invoke(request);
      if (!mounted.current) return;
      if (!response.success || !response.data) throw new Error('Task acceptance unknown');
      const task = response.data;
      setPending(null);
      setQuery('');
      setTasks((current) => (current.some((item) => item.id === task.id) ? current : [...current, task]));
      if (task.session_id !== sessionId) setSearch({ session: task.session_id });
      else await onLoadLists();
    } catch {
      /* Retain the identical request key until the server acknowledges it. */
    } finally {
      if (mounted.current) setIsSending(false);
    }
  }

  return (
    <div className='flex-1 min-h-0 overflow-y-auto p-4'>
      <div className='flex items-center justify-between gap-3'>
        <Typography.Title heading={4}>{t('agent.external.title')}</Typography.Title>
        {access?.can_manage && <Button onClick={() => setIsManagementOpen(true)}>{t('agent.external.manage.title')}</Button>}
      </div>
      <Drawer title={t('agent.external.manage.title')} width={880} visible={isManagementOpen} onCancel={() => setIsManagementOpen(false)} footer={null} unmountOnExit>
        {isManagementOpen && access && <ExternalAgentManagement isPlatformAdmin={access.can_manage_policy} isCredentialStorageAvailable={access.credential_storage_available} onChanged={onLoadLists} />}
      </Drawer>
      <Alert type='info' content={t('agent.external.pilot')} className='mb-4' />
      <Space className='mb-4' wrap>
        <Select
          aria-label={t('agent.external.selectAgent')}
          placeholder={t('agent.external.selectAgent')}
          style={{ width: 240 }}
          value={selectedAgentId || undefined}
          disabled={Boolean(sessionId) || Boolean(pending) || isSending}
          onChange={setAgentId}
          options={agents.map((agent) => ({ label: agent.name, value: agent.id }))}
        />
        <Select
          aria-label={t('agent.external.history')}
          placeholder={t('agent.external.history')}
          style={{ width: 280 }}
          value={sessionId || undefined}
          disabled={Boolean(pending) || isSending}
          onChange={(value) => setSearch({ session: value })}
          options={sessions.map((item) => ({ label: item.title, value: item.id }))}
        />
        <Button
          disabled={Boolean(pending) || isSending}
          onClick={() => {
            setSearch({});
            setTasks([]);
            setQuery('');
          }}
        >
          {t('agent.external.newSession')}
        </Button>
        <Button disabled={isSending} onClick={() => setPollGeneration((value) => value + 1)}>
          {t('agent.external.refresh')}
        </Button>
      </Space>
      {isLoadFailed && <Alert type='error' content={t('agent.external.loadFailed')} className='mb-4' />}
      {isPollFailed && <Alert type='warning' content={t('agent.external.pollFailed')} className='mb-4' />}
      {isUnknown && <Alert type='warning' content={t('agent.external.unknown')} className='mb-4' />}
      {!isLoading && !isLoadFailed && !agents.length && <Empty description={t('agent.external.empty')} />}
      <Space direction='vertical' className='w-full mb-4'>
        {tasks.map((task) => (
          <Card key={task.id} title={task.query} extra={<Tag>{t(`agent.external.status.${task.status}`)}</Tag>}>
            <div role='status' aria-live='polite' className='whitespace-pre-wrap break-words'>
              {task.answer || t('agent.external.waiting')}
            </div>
            {task.output_status === 'invalid' && <Alert className='mt-3' type='warning' content={t('agent.external.invalidOutput')} />}
            {task.error_code && <Typography.Paragraph type='secondary'>{t('agent.external.taskError', { code: task.error_code })}</Typography.Paragraph>}
          </Card>
        ))}
      </Space>
      {pending && !isSending && <Alert type='warning' content={t('agent.external.sendUnconfirmed')} className='mb-3' />}
      <Input.TextArea aria-label={t('agent.external.query')} placeholder={t('agent.external.query')} value={query} maxLength={8000} disabled={isBusy || Boolean(pending) || isLoadFailed} onChange={setQuery} autoSize={{ minRows: 3, maxRows: 8 }} />
      <Button className='mt-3' type='primary' loading={isSending} disabled={!pending && (isBusy || isLoadFailed || !selectedAgentId || !query.trim() || !agents.some((agent) => agent.id === selectedAgentId))} onClick={() => void onSend()}>
        {t(pending ? 'agent.external.retrySameRequest' : 'agent.external.send')}
      </Button>
      <Typography.Paragraph type='secondary' className='mt-3'>
        {t('agent.external.lifecycle')}
      </Typography.Paragraph>
    </div>
  );
}
