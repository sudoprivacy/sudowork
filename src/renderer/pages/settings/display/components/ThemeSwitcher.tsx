/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { IconDesktop, IconMoon, IconSun } from '@arco-design/web-react/icon';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemePreference } from '@/renderer/hooks/useTheme';
import { useThemeContext } from '@/renderer/context/ThemeContext';

/**
 * 主题切换器组件 / Theme switcher component
 *
 * 每个选项显示图标 + 文字（浅色 / 深色 / 系统），选中项带圆角胶囊底色
 * Each option shows an icon + label (Light / Dark / System); the active one has a rounded pill background
 */
export const ThemeSwitcher = () => {
  const { themePreference, setTheme } = useThemeContext();
  const { t } = useTranslation();

  const options: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: t('settings.lightMode', '浅色'), icon: <IconSun style={{ fontSize: 16 }} /> },
    { value: 'dark', label: t('settings.darkMode', '深色'), icon: <IconMoon style={{ fontSize: 16 }} /> },
    { value: 'system', label: t('settings.systemMode', '系统'), icon: <IconDesktop style={{ fontSize: 16 }} /> },
  ];

  return (
    <div className='inline-flex items-center gap-1' role='radiogroup' aria-label={t('settings.theme', '主题')}>
      {options.map((option) => {
        const isActive = themePreference === option.value;
        return (
          <button
            key={option.value}
            type='button'
            role='radio'
            aria-checked={isActive}
            aria-label={option.label}
            className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-sm font-medium transition-all duration-150 cursor-pointer border-none ${isActive ? 'bg-fill-2 text-1' : 'bg-transparent text-3 hover:bg-fill-1'}`}
            onClick={() => {
              if (!isActive) void setTheme(option.value);
            }}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};
