/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TChatConversation } from '@/common/storage';
import DeliverablesPanel from './right-panel/DeliverablesPanel';
import './workspace/workspace-card.css';

export default function ChatSider({ conversation, teamId }: IChatSiderProps) {
  const { t } = useTranslation();

  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--color-bg-1)]'>
      <div className='right-panel-tabs'>
        <button type='button' role='tab' aria-selected className='right-panel-tabs__item right-panel-tabs__item--active'>
          <span className='relative z-10'>{t('conversation.rightPanel.tabs.deliverables')}</span>
          <span aria-hidden='true' className='right-panel-tabs__indicator' />
        </button>
      </div>
      <div className='right-panel-stack'>
        <div className='right-panel-stack__pane right-panel-stack__pane--active'>
          <DeliverablesPanel conversationId={conversation?.id} teamId={teamId} />
        </div>
      </div>
    </div>
  );
}

interface IChatSiderProps {
  conversation?: TChatConversation;
  teamId?: string;
}
