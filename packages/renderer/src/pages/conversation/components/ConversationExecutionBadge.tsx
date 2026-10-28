import { Tooltip } from '@arco-design/web-react';
import { Cloud, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ConversationExecutionBadge({ target }: IConversationExecutionBadgeProps) {
  const { t } = useTranslation();
  const isRemote = target === 'remote';
  const label = t(isRemote ? 'conversation.welcome.execution.cloud' : 'conversation.welcome.execution.local');
  const hint = t(isRemote ? 'conversation.header.remoteExecutionHint' : 'conversation.header.localExecutionHint');
  const Icon = isRemote ? Cloud : Monitor;

  return (
    <Tooltip content={hint} position='bottom'>
      <span className={`conversation-execution-badge conversation-execution-badge--${target} inline-flex items-center gap-1.5 shrink-0 rounded-full px-2.5 py-1 text-12px font-medium leading-4`} role='status' aria-label={`${label}：${hint}`} data-testid='conversation-execution-badge'>
        <Icon size={14} aria-hidden />
        <span className='conversation-execution-badge__label'>{label}</span>
      </span>
    </Tooltip>
  );
}

interface IConversationExecutionBadgeProps {
  target: 'local' | 'remote';
}
