import ExternalAgentUsageDetails from './ExternalAgentUsageDetails';
import ExternalVersionSelector from './ExternalVersionSelector';
import ExternalTaskEvidence from './ExternalTaskEvidence';
import { Alert, Button, Input, Spin, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { ArrowUp, Copy, Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MarkdownView from '@renderer/components/Markdown';
import { applyExternalEventsPage } from '@sudowork/moss-client/external-providers';
import type { CreateExternalTask, ExternalSession, ExternalTask } from '@sudowork/contracts/external-provider';
import { externalProviders } from '@sudowork/host-bridge/ipcBridge';
import ChatLayout from '@renderer/pages/conversation/ChatLayout';
import { useConversationTabs } from '@renderer/pages/conversation/context/ConversationTabsContext';
import { usePreviewContext } from '@renderer/pages/conversation/preview';
import { emitter } from '@renderer/utils/emitter';
import { copyText } from '@renderer/utils/clipboard';
import { externalConversationPath, EXTERNAL_CONVERSATION_PREFIX, newExternalConversationPath } from './navigation';
import { useExternalDirectory, useExternalIdentity } from './useExternalDirectory';

const ExternalAnswer = memo(function ExternalAnswer({ text }: IExternalAnswerProps) {
  return <MarkdownView isExternalContent>{text}</MarkdownView>;
});

const isFinished = (task: ExternalTask) => ['succeeded', 'failed', 'rejected', 'unknown'].includes(task.status);

export default function ExternalConversationPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const identity = useExternalIdentity();
  return <ExternalChat key={`${identity}:${id}:${search.get('agent') || ''}`} sessionId={id.slice(EXTERNAL_CONVERSATION_PREFIX.length)} agentId={search.get('agent') || ''} />;
}

function ExternalChat({ sessionId: routeSessionId, agentId }: IExternalChatProps) {
  const sessionId = routeSessionId === 'new' ? '' : routeSessionId;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, identity, isLoading: isDirectoryLoading, isFailed: isDirectoryFailed, onRefresh } = useExternalDirectory();
  const [session, setSession] = useState<ExternalSession | null>(null);
  const [tasks, setTasks] = useState<ExternalTask[]>([]);
  const [query, setQuery] = useState('');
  const [release, setRelease] = useState('');
  const [evidenceTaskId, setEvidenceTaskId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(sessionId));
  const [isLoadFailed, setIsLoadFailed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPollFailed, setIsPollFailed] = useState(false);
  const [pending, setPending] = useState<CreateExternalTask | null>(null);
  const [pollGeneration, setPollGeneration] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const mounted = useRef(true);
  const scroll = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const { closeAllTabs } = useConversationTabs();
  const { closePreview } = usePreviewContext();
  useEffect(() => {
    closeAllTabs();
    closePreview();
  }, [closeAllTabs, closePreview]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onLoadHistory = useCallback(async () => {
    if (!identity || !sessionId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setIsLoadFailed(false);
    try {
      const [sessions, history] = await Promise.all([externalProviders.sessions.invoke(), externalProviders.history.invoke({ sessionId })]);
      if (!mounted.current) return;
      if (!sessions.success || !sessions.data || !history.success || !history.data) throw new Error('History unavailable');
      // History remains readable even after catalog approval is revoked or the latest-100 list rolls over.
      setSession(sessions.data.find((item) => item.id === sessionId) ?? null);
      setTasks(history.data);
    } catch {
      if (mounted.current) setIsLoadFailed(true);
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [identity, sessionId]);
  useEffect(() => {
    void onLoadHistory();
  }, [onLoadHistory]);

  const selectedAgentId = session?.agent_id || tasks[0]?.agent_id || agentId;
  const agent = agents.find((item) => item.id === selectedAgentId);
  const provider = agent?.provider || tasks[0]?.provider;
  const activeTask = tasks.find((item) => !isFinished(item));
  const activeTaskId = activeTask?.id;
  const activeTaskRef = useRef(activeTask);
  activeTaskRef.current = activeTask;
  const isUnknown = tasks.some((item) => item.status === 'unknown');
  const isBusy = isSending || isLoading || Boolean(activeTask) || isUnknown;
  const isVersionMissing = !sessionId && !release;
  const isReadOnly = !isDirectoryLoading && !agent;
  const title = agent?.name || t('agent.external.published.fallbackName');

  useEffect(() => {
    if (!activeTaskId) return;
    let isCancelled = false;
    let cursor = 0;
    let idlePolls = 0;
    let isPolling = false;
    let isStopped = false;
    let currentTask = activeTaskRef.current;
    let timer: ReturnType<typeof setTimeout>;
    setIsPollFailed(false);
    const onPoll = async () => {
      if (isPolling || isStopped || isCancelled || document.hidden) return;
      isPolling = true;
      try {
        const response = await externalProviders.events.invoke({ taskId: activeTaskId, cursor });
        if (isCancelled) return;
        if (!response.success || !response.data) throw new Error('Events unavailable');
        const page = response.data;
        if (!currentTask) throw new Error('Task unavailable');
        currentTask = applyExternalEventsPage(currentTask, cursor, page);
        const isChanged = page.next_cursor !== cursor;
        cursor = page.next_cursor;
        idlePolls = isChanged ? 0 : Math.min(idlePolls + 1, 3);
        const updatedTask = currentTask;
        if (isChanged || page.task) setTasks((current) => current.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
        if (isFinished(updatedTask)) {
          isStopped = true;
          emitter.emit('chat.history.refresh');
          return;
        }
        const delay = document.hidden ? 15000 : page.has_more ? 0 : Math.min(6000, 750 * 2 ** idlePolls);
        timer = setTimeout(() => void onPoll(), delay);
      } catch {
        isStopped = true;
        if (!isCancelled) setIsPollFailed(true);
      } finally {
        isPolling = false;
      }
    };
    const onVisibility = () => {
      if (isPolling || isStopped || isCancelled) return;
      clearTimeout(timer);
      if (!document.hidden) {
        idlePolls = 0;
        void onPoll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    void onPoll();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeTaskId, pollGeneration]);

  useEffect(() => {
    if (isAtBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [tasks, pending]);

  async function onSend() {
    if (isSending || (!pending && (isBusy || isReadOnly || isDirectoryLoading || isLoadFailed || isVersionMissing || !query.trim()))) return;
    const request = pending ?? {
      agent_id: selectedAgentId,
      ...(sessionId ? { session_id: sessionId } : release.startsWith('version:') ? { requested_version: release.slice(8) } : { requested_channel: release.slice(8) as 'stable' | 'canary' }),
      query: query.trim(),
      idempotency_key: crypto.randomUUID(),
    };
    setPending(request);
    setIsSending(true);
    try {
      const response = await externalProviders.create.invoke(request);
      if (!mounted.current) return;
      if (!response.success || !response.data) throw new Error('Acceptance unconfirmed');
      const task = response.data;
      setPending(null);
      setQuery('');
      isAtBottom.current = true;
      setTasks((current) => (current.some((item) => item.id === task.id) ? current : [...current, task]));
      emitter.emit('chat.history.refresh');
      if (task.session_id !== sessionId) void navigate(externalConversationPath(task.session_id), { replace: true });
    } catch {
      /* Retry preserves the exact request until acknowledgment. */
    } finally {
      if (mounted.current) setIsSending(false);
    }
  }

  return (
    <ChatLayout
      sider={null}
      workspaceEnabled={false}
      title={session?.title || title}
      headerLeft={
        <div className='flex gap-2 items-center'>
          <Typography.Text bold>{title}</Typography.Text>
          <Tag>{agent?.protocol || (provider && ['dify', 'custom_http'].includes(provider) ? t(`agent.external.provider.${provider}`) : provider || t('agent.external.chat.hosted'))}</Tag>
        </div>
      }
      headerExtra={
        <Button icon={<Plus size={16} />} disabled={!agent || Boolean(pending) || isSending} onClick={() => void navigate(newExternalConversationPath(selectedAgentId))}>
          {t('agent.external.newSession')}
        </Button>
      }
    >
      <div className='flex flex-col flex-1 min-h-0'>
        {agent?.conversation_mode === 'single_turn' && <Alert type='info' content={t('agent.external.protocol.singleTurn')} />}
        <div
          ref={scroll}
          role='log'
          aria-label={t('agent.external.chat.messages')}
          className='flex-1 min-h-0 overflow-y-auto px-4 py-4'
          onScroll={() => {
            const el = scroll.current;
            if (el) isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className='max-w-800px mx-auto w-full'>
            <Alert type='info' content={t('agent.external.pilot')} className='mb-4' />
            {isLoading && <Spin />}
            {(isLoadFailed || isDirectoryFailed) && (
              <Alert
                type='error'
                content={t('agent.external.loadFailed')}
                action={
                  <Button
                    onClick={() => {
                      void onRefresh();
                      void onLoadHistory();
                    }}
                  >
                    {t('agent.external.refresh')}
                  </Button>
                }
              />
            )}
            {!isLoading && isReadOnly && <Alert type='warning' content={t('agent.external.chat.unavailable')} />}
            {isPollFailed && <Alert type='warning' content={t('agent.external.pollFailed')} action={<Button onClick={() => setPollGeneration((value) => value + 1)}>{t('agent.external.refresh')}</Button>} />}
            {isUnknown && <Alert type='warning' content={t('agent.external.unknown')} />}
            {!isLoading && !tasks.length && agent && <div className='py-8 text-center text-secondary'>{t('agent.external.chat.welcome', { name: title })}</div>}
            {tasks.map((task) => (
              <div key={task.id} data-task-id={task.id} className='mb-6'>
                <div className='message-item flex justify-end mt-3 mb-4'>
                  <div className='max-w-full rounded-2xl bg-3 px-4 py-3 whitespace-pre-wrap break-words'>{task.query}</div>
                </div>
                <div className='message-item min-w-0 break-words' aria-label={t('agent.external.chat.reply')}>
                  <div className='markdown-body'>
                    <ExternalAnswer text={task.answer || (isFinished(task) ? t('agent.external.chat.noOutput') : t('agent.external.waiting'))} />
                  </div>
                  <div className='flex gap-2 items-center mt-2 text-xs text-secondary' role='status'>
                    <span>{t(`agent.external.status.${task.status}`)}</span>
                    <Button type='text' size='mini' onClick={() => setEvidenceTaskId(task.id)}>
                      {t('agent.external.versions.evidence')}
                    </Button>
                    {task.answer && (
                      <Tooltip content={t('common.copy')}>
                        <Button
                          type='text'
                          size='mini'
                          aria-label={t('common.copy')}
                          icon={<Copy size={14} />}
                          onClick={() => {
                            void copyText(task.answer)
                              .then(() => setCopyStatus(t('agent.external.chat.copied')))
                              .catch(() => setCopyStatus(t('common.copyFailed')));
                          }}
                        />
                      </Tooltip>
                    )}
                  </div>
                  {task.output_status === 'invalid' && <Alert type='warning' content={t('agent.external.invalidOutput')} />}
                  {task.reconciliation && <Alert type='info' content={t('agent.external.chat.reconciled')} />}
                  {task.policy_decision?.status === 'rejected' && <Alert type='warning' content={t('agent.external.chat.policyRejected', { reason: task.policy_decision.reason })} />}
                  {task.error_code && task.policy_decision?.status !== 'rejected' && (
                    <Typography.Paragraph type='secondary'>
                      {task.error_code === 'EXTERNAL_EXECUTION_CLEANUP_PENDING'
                        ? t('agent.external.taskCleanupPending')
                        : task.error_code === 'PROVIDER_CREDENTIAL_DISCLOSURE'
                          ? t('agent.external.credentialDisclosure')
                          : task.status === 'failed' && ['MODEL_CONTENT_DENIED', 'MODEL_CLASSIFIER_UNAVAILABLE', 'MODEL_REDACTION_UNSAFE'].includes(task.error_code)
                            ? t(`agent.external.modelRejection.${task.error_code}`)
                            : t('agent.external.taskError', { code: task.error_code })}
                    </Typography.Paragraph>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className='shrink-0 px-4 pb-4 pt-2'>
          <div className='max-w-800px mx-auto w-full'>
            {copyStatus && (
              <div role='status' className='text-secondary text-xs mb-2'>
                {copyStatus}
              </div>
            )}
            {!sessionId && agent && <ExternalVersionSelector key={selectedAgentId} agentId={selectedAgentId} value={release} isDisabled={isBusy || Boolean(pending)} onChange={setRelease} />}
            {sessionId && (
              <Typography.Paragraph type='secondary' className='text-xs'>
                {t('agent.external.versions.sessionPinned')}
              </Typography.Paragraph>
            )}
            {pending && !isSending && <Alert type='warning' content={t('agent.external.sendUnconfirmed')} className='mb-3' />}
            <div className='border border-solid border-[var(--color-border-2)] rounded-2xl p-3 bg-1'>
              <Input.TextArea
                aria-label={t('agent.external.query')}
                placeholder={t('agent.external.query')}
                value={query}
                onChange={setQuery}
                maxLength={8000}
                disabled={isBusy || isReadOnly || isDirectoryLoading || Boolean(pending) || isLoadFailed}
                autoSize={{ minRows: 2, maxRows: 8 }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void onSend();
                  }
                }}
              />
              <div className='flex justify-between items-center gap-3 mt-2'>
                <Typography.Text type='secondary' className='text-xs'>
                  {t('agent.external.chat.inputHint')}
                </Typography.Text>
                <Button type='primary' shape='round' icon={<ArrowUp size={16} />} loading={isSending} disabled={isSending || (!pending && (isBusy || isReadOnly || isDirectoryLoading || isLoadFailed || isVersionMissing || !query.trim()))} onClick={() => void onSend()}>
                  {t(pending ? 'agent.external.retrySameRequest' : 'agent.external.send')}
                </Button>
              </div>
            </div>
            {agent && <ExternalAgentUsageDetails agent={agent} />}
          </div>
        </div>
      </div>
      {evidenceTaskId && <ExternalTaskEvidence key={evidenceTaskId} taskId={evidenceTaskId} onClose={() => setEvidenceTaskId(null)} />}
    </ChatLayout>
  );
}
interface IExternalChatProps {
  sessionId: string;
  agentId: string;
}
interface IExternalAnswerProps {
  text: string;
}
