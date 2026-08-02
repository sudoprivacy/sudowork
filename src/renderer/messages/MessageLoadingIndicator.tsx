/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function MessageLoadingIndicator() {
  const { t } = useTranslation();

  return (
    <div className='min-w-0 flex w-full message-item m-t-10px max-w-full md:max-w-800px mx-auto justify-start'>
      <div className='flex items-center gap-2 text-foreground-secondary'>
        <Loader2 className='w-5 h-5 animate-spin' />
        <span className='text-sm'>{t('messages.processing')}</span>
      </div>
    </div>
  );
}

export default MessageLoadingIndicator;
