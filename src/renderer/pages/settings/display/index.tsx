/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import FontSizeControl from '@/renderer/pages/settings/display/components/FontSizeControl';
import { ThemeSwitcher } from '@/renderer/pages/settings/display/components/ThemeSwitcher';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import PageWrapper from '@renderer/components/base/PageWrapper';

const PreferenceRow: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className='flex flex-col items-stretch gap-2.5 border-b border-border py-3 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-6'>
    <div className='text-14px text-foreground leading-22px'>{label}</div>
    <div className='w-full flex md:flex-1 md:justify-end'>{children}</div>
  </div>
);

const DisplaySettings: React.FC = () => {
  const { t } = useTranslation();

  const displayItems = [
    { key: 'theme', label: t('settings.theme', '主题'), component: <ThemeSwitcher /> },
    { key: 'fontSize', label: t('settings.fontSize', '缩放'), component: <FontSizeControl /> },
  ];

  return (
    <PageWrapper title={t('settings.display')}>
      <div className='flex flex-col h-full w-full'>
        {/* 内容区域 / Content Area */}
        <AionScrollArea className='flex-1 min-h-0 pb-4' disableOverflow>
          <div className='space-y-4'>
            <div className='space-y-3'>
              <div className='flex w-full flex-col border border-border bg-card px-6 rd-16px'>
                {displayItems.map((item) => (
                  <PreferenceRow key={item.key} label={item.label}>
                    {item.component}
                  </PreferenceRow>
                ))}
              </div>
            </div>
          </div>
        </AionScrollArea>
      </div>
    </PageWrapper>
  );
};

export default DisplaySettings;
