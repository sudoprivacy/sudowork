/// <reference types="vite/client" />
/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Descriptions, Popover } from '@arco-design/web-react';
import { IconMoon, IconSun } from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';
import type { ThemePreference } from '@/renderer/hooks/useTheme';
import { useThemeContext } from '@/renderer/context/ThemeContext';

type DebugThemeOption = Extract<ThemePreference, 'light' | 'dark'>;

const DebuggerInfo: React.FC = () => {
  const location = useLocation();
  const params = useParams();

  const fullPath = location.pathname + location.search + location.hash;

  const rows: [string, string][] = [
    ['url', fullPath],
    ['params', Object.keys(params).length ? JSON.stringify(params, null, 2) : '—'],
  ];

  return (
    <div className='font-mono'>
      <Descriptions column={1} data={rows.map(([label, value]) => ({ label, value }))} size='small' layout='inline-horizontal' labelStyle={{ width: 64, minWidth: 64 }} />
    </div>
  );
};

const DebuggerThemeSwitch: React.FC = () => {
  const { themePreference, setTheme } = useThemeContext();
  const { t } = useTranslation();

  const themeOptions: { value: DebugThemeOption; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: t('settings.lightMode'), icon: <IconSun style={{ fontSize: 14 }} /> },
    { value: 'dark', label: t('settings.darkMode'), icon: <IconMoon style={{ fontSize: 14 }} /> },
  ];

  return (
    <div className='mt-3 flex items-center justify-between gap-3 border-t border-light pt-3'>
      <div className='shrink-0 font-sans text-12px text-3'>{t('settings.theme')}</div>
      <div className='inline-flex items-center gap-1 rounded-full bg-fill-1 p-1'>
        {themeOptions.map((option) => {
          const isActive = themePreference === option.value;

          return (
            <Button
              key={option.value}
              size='mini'
              type={isActive ? 'primary' : 'text'}
              icon={option.icon}
              className='!h-7 !rounded-full'
              onClick={() => {
                if (!isActive) void setTheme(option.value);
              }}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
};

const DebugPanel: React.FC = () => {
  const [visible, setVisible] = useState(false);

  if (!import.meta.env.DEV) return null;

  return (
    <div className='fixed bottom-4 right-4 z-9999'>
      <Popover
        position='tr'
        popupVisible={visible}
        className='!w-[420px] !max-w-[420px]'
        triggerProps={{ autoFitPosition: false }}
        content={
          <div>
            <div className='flex items-center justify-between mb-2'>
              <span className='font-sans font-600 text-14px text-1'>Debugger</span>
              <Button size='mini' type='text' onClick={() => setVisible(false)}>
                ✕
              </Button>
            </div>
            <DebuggerInfo />
            <DebuggerThemeSwitch />
          </div>
        }
      >
        <Button size='small' type='primary' onClick={() => setVisible((v) => !v)}>
          Debugger
        </Button>
      </Popover>
    </div>
  );
};

export default DebugPanel;
