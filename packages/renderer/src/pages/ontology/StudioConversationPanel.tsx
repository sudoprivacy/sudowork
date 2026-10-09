import styles from '@sudowork/ontology-ui/studio/studio.module.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Message, Modal, Select, Spin, Tag } from '@arco-design/web-react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { IOntologyAiBuilderSession } from '@sudowork/host-bridge/ipcBridge';
import type { TChatConversation } from '@sudowork/common/storageTypes';
import type { IStudioChatContext } from '@sudowork/ontology-ui';
import AcpChat from '../conversation/acp/AcpChat';
import { createStudioConversation, ensureDefaultStudioConversation, withStudioConversationTimeout } from './studioConversation';

export default function StudioConversationPanel({ workspaceId, workspaceName, context, requestedConversationId }: IStudioConversationPanelProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<IOntologyAiBuilderSession[]>([]);
  const [conversation, setConversation] = useState<TChatConversation>();
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [name, setName] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [retryAttempt, setRetryAttempt] = useState(0);
  const isMountedRef = useRef(true);
  const manualCreationRef = useRef<Promise<IOntologyAiBuilderSession> | undefined>(undefined);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const errorText = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return message.startsWith('ontology.') ? t(message) : message;
    },
    [t]
  );
  const selectedId = searchParams.get('sessionId');
  const onSelect = useCallback((conversationId: string) => setSearchParams({ sessionId: conversationId }, { replace: true }), [setSearchParams]);
  const lastRequestedConversation = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (requestedConversationId && requestedConversationId !== lastRequestedConversation.current) onSelect(requestedConversationId);
    lastRequestedConversation.current = requestedConversationId;
  }, [requestedConversationId, onSelect]);
  useEffect(() => {
    let isCancelled = false;
    let requestId = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onLoad = (isEnsureDefault: boolean) => {
      const request = ++requestId;
      clearTimeout(timer);
      setIsLoading(true);
      setSessionError('');
      const onFailure = (error: unknown) => {
        if (isCancelled || request !== requestId) return;
        setSessionError(errorText(error));
        setIsLoading(false);
      };
      timer = setTimeout(() => onFailure(new Error('ontology.studio.errors.sessionPreparationTimeout')), 30_000);
      const operation = (async () => {
        const result = await ipcBridge.ontologyAiBuilder.listSessions.invoke({ workspaceId });
        if (!result.success) throw new Error(result.msg || 'ontology.errors.loadFailed');
        const items = (result.data?.items || []).filter((item) => item.workspaceId === workspaceId);
        if (!items.length && isEnsureDefault) return [await ensureDefaultStudioConversation({ workspaceId, title: workspaceName })];
        return items;
      })();
      void operation
        .then((items) => {
          if (isCancelled || request !== requestId) return;
          setSessions(items);
          setSessionError('');
          setIsLoading(false);
        }, onFailure)
        .finally(() => {
          if (request === requestId) clearTimeout(timer);
        });
    };
    onLoad(true);
    const off = ipcBridge.ontologyAiBuilder.sessionsChanged.on((event) => {
      // Refresh after explicit deletion without immediately recreating the deleted conversation.
      if (event.workspaceId === workspaceId) onLoad(false);
    });
    return () => {
      isCancelled = true;
      clearTimeout(timer);
      off();
    };
  }, [workspaceId, workspaceName, retryAttempt, errorText]);
  useEffect(() => {
    if (!isLoading && sessions.length && !sessions.some((item) => item.conversationId === selectedId)) onSelect(sessions[0].conversationId);
  }, [sessions, isLoading, selectedId, onSelect]);
  useEffect(() => {
    let isCancelled = false;
    setConversation(undefined);
    setIsPreparing(false);
    if (!selectedId || !sessions.some((session) => session.conversationId === selectedId)) return;
    setIsPreparing(true);
    setSessionError('');
    const onFailure = (error: unknown) => {
      if (isCancelled) return;
      setSessionError(errorText(error));
      setIsPreparing(false);
    };
    const timer = setTimeout(() => onFailure(new Error('ontology.studio.errors.sessionPreparationTimeout')), 30_000);
    void ipcBridge.conversation.get
      .invoke({ id: selectedId })
      .then(async (item) => {
        if (isCancelled) return;
        if (item?.extra.purpose !== 'ontology' || item.extra.ontologyId !== workspaceId) throw new Error('ontology.studio.errors.sessionUnavailable');
        const builder = await ipcBridge.ontologyAiBuilder.ensureBuilderMcp.invoke({ workspaceId });
        if (!builder.success || !builder.data) throw new Error(builder.msg || 'ontology.studio.errors.builderUnavailable');
        if (isCancelled) return;
        const extra = { ...item.extra, extraMcpConfigs: [builder.data.mcpConfig] };
        const isUpdated = await ipcBridge.conversation.update.invoke({ id: item.id, updates: { extra } as Partial<TChatConversation>, mergeExtra: true });
        if (!isUpdated) throw new Error('ontology.studio.errors.builderUnavailable');
        if (!isCancelled) {
          setConversation({ ...item, extra } as TChatConversation);
          setSessionError('');
          setIsPreparing(false);
        }
      })
      .catch(onFailure)
      .finally(() => clearTimeout(timer));
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [selectedId, sessions, workspaceId, retryAttempt, errorText]);
  const onCreate = async () => {
    setIsCreating(true);
    const operation = createStudioConversation({ workspaceId, title: name.trim() || workspaceName });
    manualCreationRef.current = operation;
    void operation.then(
      (session) => {
        if (!isMountedRef.current || manualCreationRef.current !== operation) return;
        setSessions((items) => [session, ...items.filter((item) => item.id !== session.id)]);
        onSelect(session.conversationId);
        setIsNewOpen(false);
        setIsCreating(false);
      },
      () => {}
    );
    try {
      await withStudioConversationTimeout(operation);
    } catch (error) {
      if (isMountedRef.current) Message.error(errorText(error));
    } finally {
      if (isMountedRef.current) setIsCreating(false);
    }
  };
  const onSend = async (input: { input: string; files?: string[]; msg_id?: string; skills?: string[] }) => {
    if (!conversation) return;
    const content = context ? `${input.input}\n\n${t('ontology.studio.messageContext', { name: context.name })}${context.iri ? `\nIRI: ${context.iri}` : ''}` : input.input;
    const result = await ipcBridge.conversation.sendMessage.invoke({ conversation_id: conversation.id, input: content, files: input.files, skills: input.skills, msg_id: input.msg_id || crypto.randomUUID() });
    if (!result.success) throw new Error(result.msg || text('errors.sendFailed'));
  };
  const onDelete = () => {
    const session = sessions.find((item) => item.conversationId === selectedId);
    if (!session) return;
    Modal.confirm({
      title: text('deleteSession'),
      content: session.title,
      onOk: async () => {
        const result = await ipcBridge.ontologyAiBuilder.deleteSession.invoke({ id: session.id });
        if (!result.success) throw new Error(result.msg);
        setConversation(undefined);
        setSearchParams({}, { replace: true });
        setSessions((items) => items.filter((item) => item.id !== session.id));
      },
    });
  };
  return (
    <>
      <div className={styles['ontology-chat-heading']}>
        <Select aria-label={text('sessionHistory')} placeholder={text('sessionHistory')} value={sessions.some((item) => item.conversationId === selectedId) ? selectedId! : undefined} options={sessions.map((item) => ({ label: item.title, value: item.conversationId }))} onChange={onSelect} />
        <Button
          icon={<Plus size={14} />}
          aria-label={text('newSession')}
          onClick={() => {
            setName(workspaceName);
            setIsNewOpen(true);
          }}
        />
        <Button icon={<Trash2 size={14} />} aria-label={text('deleteSession')} disabled={!conversation} onClick={onDelete} />
      </div>
      {context && (
        <div className={styles['ontology-context']}>
          <Tag>{text('selectedContext')}</Tag>
          {context.name}
        </div>
      )}
      <div className={styles['ontology-chat-body']}>
        {sessionError ? (
          <div className={styles['ontology-chat-empty']}>
            <Alert type='warning' title={text('sessionSetupFailed')} content={sessionError} />
            <Button type='primary' onClick={() => setRetryAttempt((value) => value + 1)}>
              {text('retrySessionSetup')}
            </Button>
          </div>
        ) : isLoading || isPreparing ? (
          <div className={styles['ontology-chat-empty']}>
            <Spin />
            <span>{text('preparingSession')}</span>
          </div>
        ) : conversation?.type === 'acp' ? (
          <AcpChat key={conversation.id} conversation_id={conversation.id} workspace={conversation.extra.workspace} backend={conversation.extra.backend} sessionMode={conversation.extra.sessionMode} teamSendMessage={onSend} />
        ) : (
          <div className={styles['ontology-chat-empty']}>
            <Empty description={text('emptyChat')} />
            <Button
              type='primary'
              onClick={() => {
                setName(workspaceName);
                setIsNewOpen(true);
              }}
            >
              {text('newSession')}
            </Button>
          </div>
        )}
      </div>
      <Modal visible={isNewOpen} title={text('newSession')} onCancel={() => setIsNewOpen(false)} onOk={onCreate} confirmLoading={isCreating}>
        <Input aria-label={text('sessionName')} placeholder={text('sessionName')} value={name} onChange={setName} />
      </Modal>
    </>
  );
}

interface IStudioConversationPanelProps {
  workspaceId: string;
  workspaceName: string;
  context?: IStudioChatContext;
  requestedConversationId?: string;
}
