import { Button, Select, Tooltip } from '@arco-design/web-react';
import { List, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMemo, type ReactNode } from 'react';
import { resetGuidDraft } from '@renderer/pages/guid/hooks/useGuidDraft';
import { useConversationHistory } from '../context/ConversationHistoryContext';
import { useConversationTabs } from '../context/ConversationTabsContext';
import { getAgentConversations, getConversationAgentName, getConversationAgentRef, getSelectableConversationAgentRef } from '../utils/agentIdentity';
import ConversationTitleMinimap from './ConversationTitleMinimap';

export default function AgentSessionHeader({ conversationId, title }: IAgentSessionHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openTab } = useConversationTabs();
  const { conversations, agents, isLoading, isLoadFailed, refresh } = useConversationHistory();
  const navigation = useMemo(() => {
    const current = conversations.find((conversation) => conversation.id === conversationId);
    const reference = current && (current.extra?.agentManagement ? getConversationAgentRef(current, new Set()) : getSelectableConversationAgentRef(current, agents));
    if (!current || !reference) return undefined;
    const sessions = getAgentConversations(conversations, reference);
    return { current, reference, sessions, options: sessions.map((session) => ({ value: session.id, label: session.name })), agentName: getConversationAgentName(current, agents, t('conversation.sidebar.myAgent')) };
  }, [conversationId, conversations, agents, t]);
  if (!navigation) return <ConversationTitleMinimap title={title} conversationId={conversationId} />;
  const { current, reference, sessions, options, agentName } = navigation;

  function onSessionChange(sessionId: string) {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    openTab(session);
    void navigate(`/conversation/${encodeURIComponent(session.id)}`);
  }

  function onNewSession() {
    resetGuidDraft();
    void navigate(`/guid?assistant=${encodeURIComponent(reference)}`);
  }

  return (
    <div className='flex flex-col min-w-0 w-full gap-1'>
      <span className='truncate text-sm font-medium text-foreground' title={agentName}>
        {agentName}
      </span>
      {current.extra?.agentManagement && <span className='text-xs text-secondary'>{t('conversation.agentSessions.ownerBilling', { owner: current.extra.agentManagement.ownerName })}</span>}
      <div className='flex items-center gap-2 min-w-0'>
        <Select size='mini' className='flex-1 min-w-0' aria-label={t('conversation.agentSessions.select')} value={current.id} disabled={isLoading || isLoadFailed} onChange={onSessionChange} options={options} />
        <ConversationTitleMinimap conversationId={conversationId} title={<Button type='text' size='mini' aria-label={t('conversation.agentSessions.messages')} title={t('conversation.agentSessions.messages')} icon={<List size={16} />} />} />
        {!current.extra?.agentManagement && (
          <Tooltip content={t('conversation.agentSessions.new')}>
            <Button type='text' size='mini' aria-label={t('conversation.agentSessions.new')} disabled={isLoading || isLoadFailed} onClick={onNewSession} icon={<Plus size={16} />} />
          </Tooltip>
        )}
        {isLoadFailed && (
          <Button type='text' size='mini' onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}

interface IAgentSessionHeaderProps {
  conversationId?: string;
  title?: ReactNode;
}
