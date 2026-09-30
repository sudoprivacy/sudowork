import styles from '@sudowork/ontology-ui/studio/studio.module.css';
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Message, Modal, Select, Spin, Tag } from '@arco-design/web-react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { IOntologyAiBuilderSession } from '@sudowork/host-bridge/ipcBridge';
import type { TChatConversation } from '@sudowork/common/storageTypes';
import type { IStudioChatContext } from '@sudowork/ontology-ui';
import AcpChat from '../conversation/acp/AcpChat';
import { createStudioConversation } from './studioConversation';

export default function StudioConversationPanel({ workspaceId, workspaceName, context }: IStudioConversationPanelProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<IOntologyAiBuilderSession[]>([]);
  const [conversation, setConversation] = useState<TChatConversation>();
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [name, setName] = useState('');
  const selectedId = searchParams.get('sessionId');
  const onSelect = useCallback((conversationId: string) => setSearchParams({ sessionId: conversationId }, { replace: true }), [setSearchParams]);
  const onLoad = useCallback(async () => {
    const result = await ipcBridge.ontologyAiBuilder.listSessions.invoke({ workspaceId });
    if (!result.success) throw new Error(result.msg || t('ontology.errors.loadFailed'));
    const items = result.data?.items || [];
    setSessions(items);
    if (items.length && !items.some((item) => item.conversationId === selectedId)) onSelect(items[0].conversationId);
  }, [workspaceId, selectedId, onSelect, t]);
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    void onLoad()
      .catch((error: unknown) => {
        if (!isCancelled) Message.error(String(error));
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    const off = ipcBridge.ontologyAiBuilder.sessionsChanged.on((event) => {
      if (event.workspaceId === workspaceId) void onLoad().catch((error: unknown) => Message.error(String(error)));
    });
    return () => {
      isCancelled = true;
      off();
    };
  }, [onLoad, workspaceId]);
  useEffect(() => {
    let isCancelled = false;
    setConversation(undefined);
    if (selectedId && sessions.some((session) => session.conversationId === selectedId)) {
      void ipcBridge.conversation.get
        .invoke({ id: selectedId })
        .then(async (item) => {
          if (isCancelled || item?.extra.purpose !== 'ontology' || item.extra.ontologyId !== workspaceId) return;
          const builder = await ipcBridge.ontologyAiBuilder.ensureBuilderMcp.invoke({ workspaceId });
          if (!builder.success || !builder.data) throw new Error(builder.msg || t('ontology.studio.errors.builderUnavailable'));
          if (isCancelled) return;
          const extra = { ...item.extra, extraMcpConfigs: [builder.data.mcpConfig] };
          const isUpdated = await ipcBridge.conversation.update.invoke({ id: item.id, updates: { extra } as Partial<TChatConversation>, mergeExtra: true });
          if (!isUpdated) throw new Error(t('ontology.studio.errors.builderUnavailable'));
          if (!isCancelled) setConversation({ ...item, extra } as TChatConversation);
        })
        .catch((error: unknown) => Message.error(String(error)));
    }
    return () => {
      isCancelled = true;
    };
  }, [selectedId, sessions, workspaceId, t]);
  const onCreate = async () => {
    setIsCreating(true);
    try {
      const session = await createStudioConversation({ workspaceId, title: name.trim() || workspaceName });
      setSessions((items) => [session, ...items.filter((item) => item.id !== session.id)]);
      onSelect(session.conversationId);
      setIsNewOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Message.error(message.startsWith('ontology.') ? t(message) : message);
    } finally {
      setIsCreating(false);
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
        await onLoad();
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
        {isLoading ? (
          <div className={styles['ontology-chat-empty']}>
            <Spin />
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
}
