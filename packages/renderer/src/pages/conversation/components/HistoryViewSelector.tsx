import { Button, Radio, Tooltip } from '@arco-design/web-react';
import { AlarmClock, Bot, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import React, { useId } from 'react';
import type { SidebarTabKey } from '../grouped-history/types';

/** Keep primary history views visible without horizontal tab scrolling. */
export default function HistoryViewSelector({ value, isCronVisible, onChange }: IHistoryViewSelectorProps) {
  const { t } = useTranslation();
  const groupName = useId();
  const agentsLabel = t('conversation.sidebar.agents');
  const sessionsLabel = t('conversation.sidebar.sessions');
  const scheduledLabel = t('conversation.history.scheduledTab');
  return (
    <div className='flex items-center gap-2 min-w-0 flex-1'>
      <Radio.Group className='history-view-selector flex-1 min-w-0' name={groupName} type='button' size='small' value={value} onChange={(next) => onChange(next as SidebarTabKey)} aria-label={sessionsLabel}>
        <Radio value='agents'>
          <Tooltip content={agentsLabel}>
            <span className='history-view-content'>
              <Bot size={16} aria-hidden className='history-view-icon' />
              <span className='history-view-label'>{agentsLabel}</span>
            </span>
          </Tooltip>
        </Radio>
        <Radio value='timeline'>
          <Tooltip content={sessionsLabel}>
            <span className='history-view-content'>
              <MessageSquare size={16} aria-hidden className='history-view-icon' />
              <span className='history-view-label'>{sessionsLabel}</span>
            </span>
          </Tooltip>
        </Radio>
      </Radio.Group>
      {isCronVisible && (
        <Tooltip content={scheduledLabel}>
          <Button className='shrink-0' type={value === 'scheduled' ? 'secondary' : 'text'} size='small' aria-label={scheduledLabel} aria-pressed={value === 'scheduled'} onClick={() => onChange('scheduled')} icon={<AlarmClock size={16} aria-hidden />} />
        </Tooltip>
      )}
    </div>
  );
}

interface IHistoryViewSelectorProps {
  value: SidebarTabKey;
  isCronVisible: boolean;
  onChange: (value: SidebarTabKey) => void;
}
