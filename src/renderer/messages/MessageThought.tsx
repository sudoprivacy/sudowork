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
      <div className='flex items-center gap-6px color-#86909C cursor-pointer select-none' onClick={() => setIsExpanded(!isExpanded)}>
        <span className='flex-none'>{t('messages.thinkingProcess')}</span>
        {showSubject && <span className='truncate min-w-0 opacity-80'>{subject}</span>}
        {isExpanded ? <IconDown className='flex-none' /> : <IconRight className='flex-none' />}
      </div>
      {isExpanded && (
        <div className='p-l-16px pt-4px b-l-2px b-l-solid b-l-[rgba(134,144,156,0.3)] color-#86909C text-13px [&_p]:color-#86909C [&_li]:color-#86909C'>
          <MarkdownView>{description}</MarkdownView>
        </div>
      )}
    </div>
  );
}

interface IMessageThoughtProps {
  message: IMessageThought;
}
