/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatMessageTime } from '@renderer/utils/messageTime';

interface MessageTimeSeparatorProps {
  timestamp: number;
}

/**
 * A subtle time separator shown between messages when there's a significant time gap.
 * Follows mainstream IM design (WeChat/Telegram style) - minimal, centered, non-intrusive.
 *
 * 消息时间分隔符组件，当消息间隔较大时显示
 */
const MessageTimeSeparator: React.FC<MessageTimeSeparatorProps> = React.memo(({ timestamp }) => {
  const { t, i18n } = useTranslation();
  const timeStr = formatMessageTime(timestamp, i18n.language, t('conversation.history.yesterday'));

  return (
    <div className='flex justify-center items-center py-8px px-8px max-w-full md:max-w-780px mx-auto'>
      <span className='text-11px text-4 select-none'>{timeStr}</span>
    </div>
  );
});

MessageTimeSeparator.displayName = 'MessageTimeSeparator';

export default MessageTimeSeparator;
