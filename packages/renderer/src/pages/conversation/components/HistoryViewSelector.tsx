import { Button, Radio, Tooltip } from '@arco-design/web-react';
import { AlarmClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import React from 'react';
import type { SidebarTabKey } from '../grouped-history/types';

/** Keep primary history views visible without horizontal tab scrolling. */
export default function HistoryViewSelector({ value, isCronVisible, onChange }: IHistoryViewSelectorProps) {
  const { t } = useTranslation();
  const scheduledLabel = t('conversation.history.scheduledTab');
  return (
    <div className='flex items-center gap-2 min-w-0 flex-1'>
      <Radio.Group className='history-view-selector flex-1 min-w-0' type='button' size='small' value={value} onChange={(next) => onChange(next as SidebarTabKey)} aria-label={t('conversation.sidebar.sessions')}>
        <Radio value='agents'>{t('conversation.sidebar.agents')}</Radio>
        <Radio value='timeline'>{t('conversation.sidebar.sessions')}</Radio>
      </Radio.Group>
      {isCronVisible && (
        <Tooltip content={scheduledLabel}>
          <Button type={value === 'scheduled' ? 'secondary' : 'text'} size='small' aria-label={scheduledLabel} aria-pressed={value === 'scheduled'} onClick={() => onChange('scheduled')} icon={<AlarmClock size={16} />} />
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
