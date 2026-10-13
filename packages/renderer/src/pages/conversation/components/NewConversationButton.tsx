import { Button, Message } from '@arco-design/web-react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ConfigStorage } from '@sudowork/common/storage';
import { isPersonalAgentRef } from '@sudowork/common/personalAgents';
import { useAuth } from '@renderer/context/AuthContext';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { resetGuidDraft } from '@renderer/pages/guid/hooks/useGuidDraft';
import { useConversationHistory } from '../context/ConversationHistoryContext';

/** Start a fresh conversation under the account's default Agent. */
export default function NewConversationButton({ onSessionClick }: INewConversationButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const { isEnterprise } = useAppMode();
  const { agents, isLoading, refresh } = useConversationHistory();
  const defaultAgent = agents.find((agent) => agent.kind === 'default' && isPersonalAgentRef(agent.ref));
  const isPersonalSession = isEnterprise && !isGuest;

  function onNewConversation() {
    if (isPersonalSession && !defaultAgent) {
      Message.error(t('common.failed'));
      void refresh();
      return;
    }
    void ConfigStorage.set('guid.lastSelectedAgent', '');
    resetGuidDraft();
    void navigate(isPersonalSession ? `/guid?assistant=${encodeURIComponent(defaultAgent!.ref)}` : '/guid');
    onSessionClick();
  }

  return (
    <Button className='!h-10.5 !w-full flex-shrink-0 !justify-center gap-2 !px-3.5 mb-3 !rd-3 !border !bg-subtle hover:!bg-hover active:!bg-fill-2' disabled={isPersonalSession && isLoading} onClick={onNewConversation} icon={<Plus size={18} strokeWidth={1.8} className='text-foreground shrink-0' />}>
      <span className='text-15px font-medium text-foreground truncate'>{t('conversation.welcome.newConversation')}</span>
    </Button>
  );
}

interface INewConversationButtonProps {
  onSessionClick: () => void;
}
