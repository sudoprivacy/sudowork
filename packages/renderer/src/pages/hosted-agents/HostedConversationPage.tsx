import { Alert, Button, Input, Spin, Tag, Typography } from '@arco-design/web-react';
import { ArrowUp, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { HostedTask, HostedSession } from '@sudowork/contracts/task';
import { applyHostedEventsPage, isHostedTaskFinished, type HostedTaskInput } from '@sudowork/moss-client/hosted-tasks';
import { hostedTasks } from '@sudowork/host-bridge/ipcBridge';
import MarkdownView from '@renderer/components/Markdown';
import ChatLayout from '@renderer/pages/conversation/ChatLayout';
import { useConversationTabs } from '@renderer/pages/conversation/context/ConversationTabsContext';
import { usePreviewContext } from '@renderer/pages/conversation/preview';
import { emitter } from '@renderer/utils/emitter';
import { useExternalIdentity } from '../external-agents/useExternalDirectory';
import { useHostedDirectory } from './useHostedDirectory';
import { hostedConversationPath, HOSTED_CONVERSATION_PREFIX, newHostedConversationPath } from './navigation';

export default function HostedConversationPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const identity = useExternalIdentity();
  return <HostedChat key={`${identity}:${id}:${search.get('agent') || ''}`} identity={identity} sessionId={id.slice(HOSTED_CONVERSATION_PREFIX.length)} agentId={search.get('agent') || ''} />;
}
function HostedChat({ identity, sessionId: routeSessionId, agentId }: IHostedChatProps) {
  const sessionId = routeSessionId === 'new' ? '' : routeSessionId;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, isLoading: isDirectoryLoading, isFailed: isDirectoryFailed, onRefresh } = useHostedDirectory();
  const [session, setSession] = useState<HostedSession | null>(null);
  const [tasks, setTasks] = useState<HostedTask[]>([]);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [isLoading, setIsLoading] = useState(Boolean(sessionId));
  const [isLoadFailed, setIsLoadFailed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPollFailed, setIsPollFailed] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState('');
  const [pollGeneration, setPollGeneration] = useState(0);
  const pendingKey = `sudo.hosted.pending:${identity}:${sessionId || `new:${agentId}`}`;
  const [pending, setPending] = useState<HostedTaskInput | null>(() => {
    if (!identity) return null;
    try {
      const stored = sessionStorage.getItem(pendingKey);
      if (!stored) return null;
      const value = JSON.parse(stored) as HostedTaskInput;
      return typeof value.query === 'string' && typeof value.idempotency_key === 'string' && typeof value.agent_id === 'string' && (value.session_id || '') === sessionId && (sessionId || value.agent_id === agentId) ? value : null;
    } catch {
      return null;
    }
  });
  const mounted = useRef(true),
    sending = useRef(false),
    acting = useRef(false);
  const scroll = useRef<HTMLDivElement>(null),
    isAtBottom = useRef(true);
  const loadGeneration = useRef(0);
  const { closeAllTabs } = useConversationTabs();
  const { closePreview } = usePreviewContext();
  useEffect(() => {
    mounted.current = true;
    closeAllTabs();
    closePreview();
    return () => {
      mounted.current = false;
      loadGeneration.current++;
    };
  }, [closeAllTabs, closePreview]);
  const onLoad = useCallback(async () => {
    const current = ++loadGeneration.current;
    if (!identity || !sessionId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setIsLoadFailed(false);
    try {
      const [sessions, history] = await Promise.all([hostedTasks.sessions.invoke(), hostedTasks.history.invoke({ sessionId })]);
      if (!mounted.current || current !== loadGeneration.current) return;
      if (!sessions.success || !sessions.data || !history.success || !history.data) throw new Error('HOSTED_HISTORY_UNAVAILABLE');
      setSession(sessions.data.find((item) => item.id === sessionId) ?? null);
      setTasks(history.data);
    } catch {
      if (mounted.current && current === loadGeneration.current) setIsLoadFailed(true);
    } finally {
      if (mounted.current && current === loadGeneration.current) setIsLoading(false);
    }
  }, [identity, sessionId]);
  useEffect(() => {
    void onLoad();
  }, [onLoad]);
  const selectedAgentId = session?.agent_id || tasks[0]?.catalog_id || agentId;
  const agent = agents.find((item) => item.id === selectedAgentId);
  const active = tasks.find((task) => !isHostedTaskFinished(task));
  const activeRef = useRef(active);
  activeRef.current = active;
  const isUnknown = tasks.some((task) => task.status === 'unknown');
  const isBusy = isSending || isActing || isLoading || Boolean(active) || isUnknown;
  const isReadOnly = !identity || (!isDirectoryLoading && !agent) || Boolean(session?.closed);
  const title = agent?.name || t('agent.hosted.directory');
  useEffect(() => {
    if (!active?.id) return;
    let isCancelled = false,
      isPolling = false,
      isStopped = false;
    let cursor = 0,
      currentTask = activeRef.current!;
    let timer: ReturnType<typeof setTimeout>;
    setIsPollFailed(false);
    const onPoll = async () => {
      if (isCancelled || isPolling || isStopped || document.hidden) return;
      isPolling = true;
      try {
        const response = await hostedTasks.events.invoke({ taskId: currentTask.id, cursor });
        if (isCancelled) return;
        if (!response.success || !response.data) throw new Error('HOSTED_EVENTS_UNAVAILABLE');
        currentTask = applyHostedEventsPage(currentTask, cursor, response.data);
        cursor = response.data.next_cursor;
        const updated = currentTask;
        setTasks((previous) => previous.map((item) => (item.id === updated.id && item.sequence <= updated.sequence ? updated : item)));
        if (isHostedTaskFinished(updated) && !response.data.has_more) {
          isStopped = true;
          emitter.emit('chat.history.refresh');
          return;
        }
        timer = setTimeout(() => void onPoll(), response.data.has_more ? 0 : 1200);
      } catch {
        if (!isCancelled) {
          isStopped = true;
          setIsPollFailed(true);
        }
      } finally {
        isPolling = false;
      }
    };
    const onVisible = () => {
      if (!document.hidden && !isPolling && !isStopped) {
        clearTimeout(timer);
        void onPoll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void onPoll();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active?.id, pollGeneration]);
  useEffect(() => {
    if (isAtBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [tasks, pending]);

  async function onSend() {
    if (sending.current || !identity || (!pending && (isBusy || isReadOnly || isDirectoryLoading || isLoadFailed || !query.trim() || !agent))) return;
    const request = pending ?? { agent_id: selectedAgentId, ...(sessionId ? { session_id: sessionId } : { requested_version: agent!.version }), query: query.trim(), idempotency_key: crypto.randomUUID() };
    sending.current = true;
    setIsSending(true);
    setError('');
    try {
      // Persist before dispatch so a reload cannot silently create a new request key.
      sessionStorage.setItem(pendingKey, JSON.stringify(request));
      setPending(request);
      const response = await hostedTasks.create.invoke(request);
      if (!mounted.current) return;
      if (!response.success || !response.data) throw new Error('HOSTED_ACCEPTANCE_UNCONFIRMED');
      sessionStorage.removeItem(pendingKey);
      setPending(null);
      setQuery('');
      const task = response.data;
      setTasks((previous) => (previous.some((item) => item.id === task.id) ? previous : [...previous, task]));
      emitter.emit('chat.history.refresh');
      if (task.session_id !== sessionId) void navigate(hostedConversationPath(task.session_id), { replace: true });
    } catch {
      if (mounted.current) setError(t('agent.external.sendUnconfirmed'));
    } finally {
      sending.current = false;
      if (mounted.current) setIsSending(false);
    }
  }
  async function onAction(task: HostedTask, action: 'cancel' | 'reconcile' | 'close') {
    if (acting.current || !identity) return;
    acting.current = true;
    setIsActing(true);
    setError('');
    try {
      const response = action === 'close' ? await hostedTasks.close.invoke({ taskId: task.id, note }) : await hostedTasks[action].invoke({ taskId: task.id });
      if (!mounted.current) return;
      if (!response.success || !response.data) throw new Error('HOSTED_ACTION_FAILED');
      const updated = response.data;
      setTasks((previous) => previous.map((item) => (item.id === updated.id && item.sequence <= updated.sequence ? updated : item)));
      if (action === 'close') {
        setSession((previous) => (previous ? { ...previous, closed: true } : { id: sessionId, agent_id: selectedAgentId, title, updated_at: Date.now(), status: 'unknown', closed: true }));
        setNote('');
      }
      emitter.emit('chat.history.refresh');
    } catch {
      if (mounted.current) setError(t('agent.hosted.actionFailed'));
    } finally {
      acting.current = false;
      if (mounted.current) setIsActing(false);
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
          <Tag>{t('agent.hosted.directory')}</Tag>
        </div>
      }
      headerExtra={
        <Button icon={<Plus size={16} />} disabled={!agent || Boolean(pending) || isSending} onClick={() => void navigate(newHostedConversationPath(selectedAgentId))}>
          {t('agent.external.newSession')}
        </Button>
      }
    >
      <div className='flex flex-col flex-1 min-h-0'>
        <Alert type='info' content={t('agent.hosted.synthetic')} />
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
            {isLoading && <Spin />}
            {(isLoadFailed || isDirectoryFailed) && (
              <Alert
                type='error'
                content={t('agent.hosted.unavailable')}
                action={
                  <Button
                    onClick={() => {
                      void onRefresh();
                      void onLoad();
                    }}
                  >
                    {t('agent.external.refresh')}
                  </Button>
                }
              />
            )}
            {isReadOnly && <Alert type='warning' content={t('agent.external.chat.unavailable')} />}
            {isPollFailed && <Alert type='warning' content={t('agent.external.pollFailed')} action={<Button onClick={() => setPollGeneration((value) => value + 1)}>{t('agent.external.refresh')}</Button>} />}
            {tasks.map((task) => (
              <article key={task.id} data-task-id={task.id} className='mb-6'>
                <div className='message-item flex justify-end mt-3 mb-4'>
                  <div className='max-w-full rounded-2xl bg-3 px-4 py-3 whitespace-pre-wrap break-words'>{task.query}</div>
                </div>
                <div className='message-item min-w-0 break-words'>
                  <MarkdownView isExternalContent>{task.answer || t(isHostedTaskFinished(task) ? 'agent.external.chat.noOutput' : 'agent.external.waiting')}</MarkdownView>
                </div>
                <div role='status' className='flex flex-wrap items-center gap-2 mt-2 text-xs text-secondary'>
                  <span>{t(task.status === 'cancelled' ? 'agent.hosted.cancelled' : `agent.external.status.${task.status}`)}</span>
                  {task.cancel_requested_at !== null && task.status !== 'cancelled' && <span>{t('agent.hosted.cancelRequested')}</span>}
                  {!isHostedTaskFinished(task) && task.cancel_requested_at === null && (
                    <Button size='mini' disabled={isActing} onClick={() => void onAction(task, 'cancel')}>
                      {t('agent.hosted.cancel')}
                    </Button>
                  )}
                </div>
                {task.error_code && <Typography.Paragraph type='secondary'>{t('agent.external.taskError', { code: task.error_code })}</Typography.Paragraph>}
                {task.status === 'unknown' && (
                  <div className='space-y-2 mt-2'>
                    <Alert type='warning' content={t('agent.hosted.unknown')} />
                    <Button disabled={isActing || session?.closed} onClick={() => void onAction(task, 'reconcile')}>
                      {t('agent.hosted.reconcile')}
                    </Button>
                    {task.cleanup === 'confirmed' && !session?.closed && (
                      <>
                        <Input.TextArea aria-label={t('agent.hosted.closeNote')} placeholder={t('agent.hosted.closeNote')} value={note} onChange={setNote} maxLength={2000} />
                        <Button disabled={isActing || !note.trim()} onClick={() => void onAction(task, 'close')}>
                          {t('agent.hosted.close')}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
        <div className='shrink-0 px-4 pb-4 pt-2'>
          <div className='max-w-800px mx-auto w-full'>
            {error && <Alert type='warning' content={error} />}
            {pending && !isSending && <Alert type='warning' content={t('agent.external.sendUnconfirmed')} />}
            {!sessionId && agent && <Typography.Paragraph type='secondary'>{t('agent.hosted.version', { version: agent.version })}</Typography.Paragraph>}
            {sessionId && <Typography.Paragraph type='secondary'>{t('agent.external.versions.sessionPinned')}</Typography.Paragraph>}
            <Input.TextArea
              aria-label={t('agent.external.query')}
              placeholder={t('agent.external.query')}
              value={pending?.query ?? query}
              onChange={setQuery}
              maxLength={8000}
              disabled={isBusy || isReadOnly || isDirectoryLoading || isLoadFailed || Boolean(pending)}
              autoSize={{ minRows: 2, maxRows: 8 }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void onSend();
                }
              }}
            />
            <div className='flex justify-end mt-2'>
              <Button type='primary' shape='round' icon={<ArrowUp size={16} />} loading={isSending} disabled={isSending || !identity || (!pending && (isBusy || isReadOnly || isDirectoryLoading || isLoadFailed || !query.trim()))} onClick={() => void onSend()}>
                {t(pending ? 'agent.external.retrySameRequest' : 'agent.external.send')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ChatLayout>
  );
}
interface IHostedChatProps {
  identity: string;
  sessionId: string;
  agentId: string;
}
