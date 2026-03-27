/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { iconColors } from '@/renderer/theme/colors';
import { copyText } from '@/renderer/utils/clipboard';
import { Alert, Message, Tooltip } from '@arco-design/web-react';
import { Copy } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const TurnActions: React.FC<{ turnTexts: string[] }> = ({ turnTexts }) => {
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);

  const handleCopy = () => {
    const textToCopy = turnTexts.join('\n\n');
    copyText(textToCopy)
      .then(() => {
        setShowCopyAlert(true);
        setTimeout(() => setShowCopyAlert(false), 2000);
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  return (
    <>
      <div className='flex items-center h-28px'>
        <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
          <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={handleCopy} style={{ lineHeight: 0 }}>
            <Copy theme='outline' size='16' fill={iconColors.secondary} />
          </div>
        </Tooltip>
      </div>
      {showCopyAlert && <Alert type='success' content={t('messages.copySuccess')} showIcon className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]' style={{ boxShadow: '0px 2px 12px rgba(0,0,0,0.12)' }} closable={false} />}
    </>
  );
};

export default TurnActions;
