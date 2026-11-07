/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessageThought } from '@sudowork/common/chatLib';
import MarkdownView from '../components/Markdown';

export default function MessageThought({ message }: IMessageThoughtProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const { subject, description } = message.content;

  if (!description?.trim()) {
    return null;
  }

  const isSubjectVisible = Boolean(subject) && subject !== 'Thinking' && subject !== description;

  return (
    <div className='w-full min-w-0'>
      <Button type='text' className='!text-secondary !px-0 max-w-full' aria-expanded={isExpanded} onClick={() => setIsExpanded(!isExpanded)}>
        <span className='flex-none'>{t('messages.thinkingProcess')}</span>
        {isSubjectVisible && <span className='truncate min-w-0'>{subject}</span>}
        {isExpanded ? <IconDown className='flex-none' /> : <IconRight className='flex-none' />}
      </Button>
      {isExpanded && (
        <div className='pl-4 pt-1 border-l-2 border-l-solid border-[var(--border-default)] text-secondary'>
          <MarkdownView>{description}</MarkdownView>
        </div>
      )}
    </div>
  );
}

interface IMessageThoughtProps {
  message: IMessageThought;
}
