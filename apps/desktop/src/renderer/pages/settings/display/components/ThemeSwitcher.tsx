/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { IconDesktop, IconMoon, IconSun } from '@arco-design/web-react/icon';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemePreference } from '@/renderer/hooks/useTheme';
import { useThemeContext } from '@/renderer/context/ThemeContext';
import Tabs from '@/renderer/components/ui/Tabs';

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
    <Tabs
      ariaLabel={t('settings.theme', '主题')}
      className='gap-1'
      itemClassName='h-8 px-3.5 text-sm font-medium'
      value={themePreference}
      items={options.map((option) => ({
        value: option.value,
        label: option.label,
        icon: option.icon,
      }))}
      onChange={(value) => {
        if (themePreference !== value) void setTheme(value as ThemePreference);
      }}
    />
  );
};
