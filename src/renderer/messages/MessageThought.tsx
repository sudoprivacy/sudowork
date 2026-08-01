/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { IconDown, IconRight } from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessageThought } from '@/common/chatLib';
import MarkdownView from '../components/Markdown';

export default function MessageThought({ message }: IMessageThoughtProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const { subject, description } = message.content;

  if (!description?.trim()) {
    return null;
  }

  const showSubject = Boolean(subject) && subject !== 'Thinking' && subject !== description;

  return (
    <div className='w-full min-w-0'>
      <div className='flex cursor-pointer select-none items-center gap-1.5 text-foreground-tertiary' onClick={() => setIsExpanded(!isExpanded)}>
        <span className='flex-none'>{t('messages.thinkingProcess')}</span>
        {showSubject && <span className='truncate min-w-0 opacity-80'>{subject}</span>}
        {isExpanded ? <IconDown className='flex-none' /> : <IconRight className='flex-none' />}
      </div>
      {isExpanded && (
        <div className='border-l-2 border-border pl-4 pt-1 text-13px text-foreground-tertiary [&_li]:text-foreground-tertiary [&_p]:text-foreground-tertiary'>
          <MarkdownView>{description}</MarkdownView>
        </div>
      )}
    </div>
  );
}

interface IMessageThoughtProps {
  message: IMessageThought;
}
