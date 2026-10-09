/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

// context/ThemeContext.tsx - Unified Theme Management Context 统一主题管理上下文
import type { PropsWithChildren } from 'react';
import React, { createContext, useContext } from 'react';
import type { Theme, ThemePreference } from '../hooks/useTheme';
import useTheme from '../hooks/useTheme';
import useFontScale from '../hooks/useFontScale';

/**
 * Theme context value interface 主题上下文值接口
 */
interface ThemeContextValue {
  // Light/Dark mode 明暗模式 (resolved effective theme)
  theme: Theme;
  // Theme preference 主题偏好 (user's choice including 'system')
  themePreference: ThemePreference;
  setTheme: (preference: ThemePreference) => Promise<void>;

  // Font scaling 字体缩放
  fontScale: number;
  setFontScale: (scale: number) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Theme provider component 主题提供者组件
 * Manages light/dark mode and font scaling 管理明暗模式与字体缩放
 */
export const ThemeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [theme, themePreference, setTheme] = useTheme();
  const [fontScale, setFontScale] = useFontScale();

  return <ThemeContext.Provider value={{ theme, themePreference, setTheme, fontScale, setFontScale }}>{children}</ThemeContext.Provider>;
};

/**
 * Hook to access theme context 访问主题上下文的 Hook
 * @throws {Error} If used outside of ThemeProvider 如果在 ThemeProvider 外使用会抛出错误
 */
export const useThemeContext = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within ThemeProvider');
  }
  return context;
};
