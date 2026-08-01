/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { FolderCheck } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TChatConversation } from '@/common/storage';
import Tabs from '@/renderer/components/ui/Tabs';
import DeliverablesPanel from './right-panel/DeliverablesPanel';

export default function ChatSider({ conversation, teamId }: IChatSiderProps) {
  const { t } = useTranslation();

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <Tabs
        ariaLabel={t('conversation.rightPanel.tabs.deliverables')}
        className='shrink-0 px-3 pt-1'
        itemClassName='h-10'
        variant='line'
        value='deliverables'
        items={[{ value: 'deliverables', label: t('conversation.rightPanel.tabs.deliverables'), icon: <FolderCheck size={14} /> }]}
        onChange={() => undefined}
      />
      <DeliverablesPanel conversationId={conversation?.id} teamId={teamId} />
    </div>
  );
}

interface IChatSiderProps {
  conversation?: TChatConversation;
  teamId?: string;
}
