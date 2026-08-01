/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlarmClock } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CronMessageMeta } from '@/common/chatLib';

type MessageCronBadgeProps = {
  meta: CronMessageMeta;
};

const formatTime = (timestamp: number, locale: string): string => {
  return new Date(timestamp).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const MessageCronBadge: React.FC<MessageCronBadgeProps> = ({ meta }) => {
  const { i18n } = useTranslation();

  return (
    <div className='mb-1 inline-flex items-center gap-1 rounded-full bg-fill-shallow px-3 py-0.5 text-foreground-secondary'>
      <AlarmClock strokeWidth={4} size={13} className='flex items-center' />
      <span>{formatTime(meta.triggeredAt, i18n.language)}</span>
    </div>
  );
};

export default MessageCronBadge;
