/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Progress } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { libreOffice as libreOfficeIpc } from '@/common/ipcBridge';

interface LibreOfficeInstallPromptProps {
  fileType: 'word' | 'excel' | 'ppt';
  installing: boolean;
  percent?: number;
  phase?: string;
  onInstall: () => void;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  word: '📄',
  excel: '📊',
  ppt: '📊',
};

const FILE_TYPE_TITLES: Record<string, string> = {
  word: 'preview.word.title',
  excel: 'preview.excel.title',
  ppt: 'preview.pptTitle',
};

const LibreOfficeInstallPrompt: React.FC<LibreOfficeInstallPromptProps> = ({ fileType, installing, percent, phase, onInstall }) => {
  const { t } = useTranslation();
  const icon = FILE_TYPE_ICONS[fileType] || '📄';
  const titleKey = FILE_TYPE_TITLES[fileType] || 'preview.document';

  return (
    <div className='h-full w-full bg-bg-1 flex items-center justify-center'>
      <div className='text-center max-w-400px px-24px'>
        <div className='text-48px mb-16px'>{icon}</div>
        <div className='text-16px text-t-primary font-medium mb-8px'>{t(titleKey)}</div>

        {!installing ? (
          <>
            <div className='text-13px text-t-secondary mb-24px'>{t('preview.libreOffice.installPrompt')}</div>
            <div className='flex items-center justify-center gap-12px'>
              <Button type='primary' onClick={onInstall}>
                {t('preview.libreOffice.installButton')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className='text-13px text-t-secondary mb-16px'>
              {t('preview.libreOffice.installing')}
              {phase && ` — ${t(`preview.libreOffice.phase.${phase}`, { defaultValue: phase })}`}
            </div>
            <Progress percent={percent ?? 0} status='normal' showText={false} strokeWidth={6} className='!mb-4px !max-w-280px !mx-auto' />
            {percent !== undefined && (
              <div className='text-12px text-t-tertiary'>{percent}%</div>
            )}
          </>
        )}

        <div className='text-11px text-t-tertiary mt-16px'>{t('preview.libreOffice.systemPrompt')}</div>
      </div>
    </div>
  );
};

export default LibreOfficeInstallPrompt;
