/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useThemeContext } from '@/renderer/context/ThemeContext';
import type { ThemePreference } from '@/renderer/hooks/useTheme';
import { IconMoonFill, IconSunFill } from '@arco-design/web-react/icon';
import React from 'react';
import { useTranslation } from 'react-i18next';

const SystemIcon: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <svg width='1em' height='1em' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg' style={style}>
    <rect x='4' y='8' width='40' height='28' rx='3' stroke='currentColor' strokeWidth='4' fill='currentColor' fillOpacity='0.15' />
    <path d='M14 44h20' stroke='currentColor' strokeWidth='4' strokeLinecap='round' />
    <path d='M24 36v8' stroke='currentColor' strokeWidth='4' strokeLinecap='round' />
  </svg>
);

/**
 * 主题切换器组件 / Theme switcher component
 *
 * 三个紧凑的图标按钮: 浅色 / 系统 / 深色
 * Three compact icon buttons: Light / System / Dark
 */
export const ThemeSwitcher = () => {
  const { themePreference, setTheme } = useThemeContext();
  const { t } = useTranslation();

  const options: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: t('settings.lightMode'), icon: <IconSunFill style={{ fontSize: 14 }} /> },
    { value: 'system', label: t('settings.systemMode'), icon: <SystemIcon style={{ fontSize: 14 }} /> },
    { value: 'dark', label: t('settings.darkMode'), icon: <IconMoonFill style={{ fontSize: 14 }} /> },
  ];

  return (
    <div className='inline-flex items-center gap-2px rd-6px bg-[var(--color-fill-1)] p-2px' role='radiogroup' aria-label={t('settings.theme')}>
      {options.map((option) => {
        const isActive = themePreference === option.value;
        return (
          <button
            key={option.value}
            type='button'
            role='radio'
            aria-checked={isActive}
            aria-label={option.label}
            title={option.label}
            className='inline-flex items-center justify-center w-26px h-26px rd-5px transition-all duration-160 cursor-pointer border-none'
            style={{
              color: isActive ? 'rgb(var(--primary-6))' : 'var(--color-text-4)',
              backgroundColor: isActive ? 'var(--color-bg-2)' : 'transparent',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
            onClick={() => {
              if (!isActive) void setTheme(option.value);
            }}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
};
