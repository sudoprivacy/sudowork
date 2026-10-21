import { hostedConversationPath } from '../hosted-agents/navigation';
import { Button, Tooltip } from '@arco-design/web-react';
import { MessageCircle } from 'lucide-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { externalConversationPath, type ExternalConversationView } from './navigation';
import { cleanupSiderTooltips } from '@renderer/utils/siderTooltip';

export default function ExternalConversationRow({ conversation, isSelected, isBatchMode, isCollapsed, onOpen }: IExternalConversationRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Tooltip content={isBatchMode ? t('agent.external.chat.historyReadOnly') : conversation.name} disabled={!isBatchMode && !isCollapsed}>
      <Button
        id={`c-${conversation.id}`}
        type='text'
        disabled={isBatchMode}
        className={classNames('chat-history__item !px-3 !py-2 !h-auto !w-full !justify-start !rounded-lg conversation-item', isSelected ? '!bg-active conversation-item--selected' : 'hover:bg-hover')}
        onClick={() => {
          cleanupSiderTooltips();
          void navigate(conversation.type === 'hosted-artifact' ? hostedConversationPath(conversation.sessionId) : externalConversationPath(conversation.sessionId));
          onOpen?.();
        }}
      >
        <MessageCircle size={20} className='shrink-0' />
        <span className='ml-2.5 truncate text-14px text-2'>{conversation.name || t('conversation.welcome.newConversation')}</span>
      </Button>
    </Tooltip>
  );
}
interface IExternalConversationRowProps {
  conversation: ExternalConversationView;
  isSelected: boolean;
  isBatchMode: boolean;
  isCollapsed: boolean;
  onOpen?: () => void;
}
