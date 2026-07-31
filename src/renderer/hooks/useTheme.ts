/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

// hooks/useTheme.ts
import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/storage';

export type Theme = 'light' | 'dark';
export type ThemePreference = 'light' | 'dark' | 'system';

const DEFAULT_PREFERENCE: ThemePreference = 'system';
const THEME_CACHE_KEY = '__sudowork_theme';

const getSystemTheme = (): Theme => {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

const resolveTheme = (preference: ThemePreference): Theme => {
  if (preference === 'system') return getSystemTheme();
  return preference;
};

const getAppliedTheme = (): Theme => {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'light' || theme === 'dark' ? theme : getSystemTheme();
};

// Apply theme to document
const applyTheme = (theme: Theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('arco-theme', theme);
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    /* noop */
  }
};

const isThemePreference = (value: unknown): value is ThemePreference => value === 'light' || value === 'dark' || value === 'system';

// 读取持久化的主题偏好并应用；无保存值时回退到默认。
// Apply the persisted theme preference; fall back to the default when absent.
const initTheme = async (): Promise<ThemePreference> => {
  // 先用缓存的已解析主题同步应用，消除首屏闪烁。
  // Apply the cached resolved theme synchronously first to avoid a first-paint flash.
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached === 'light' || cached === 'dark') applyTheme(cached);
  } catch {
    /* noop */
  }
  let preference: ThemePreference = DEFAULT_PREFERENCE;
  try {
    const saved = await ConfigStorage.get('theme');
    if (isThemePreference(saved)) preference = saved;
  } catch (error) {
    console.error('Failed to load theme preference:', error);
  }
  applyTheme(resolveTheme(preference));
  return preference;
};

// Run theme initialization immediately
let initialThemePromise: Promise<ThemePreference> | null = null;
if (typeof window !== 'undefined') {
  initialThemePromise = initTheme();
}

const useTheme = (): [Theme, ThemePreference, (preference: ThemePreference) => Promise<void>] => {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_PREFERENCE);
  const [theme, setThemeState] = useState<Theme>(getAppliedTheme);

  // Set theme preference with persistence
  const setPreference = useCallback(
    async (newPreference: ThemePreference) => {
      const prev = preference;
      try {
        setPreferenceState(newPreference);
        const resolved = resolveTheme(newPreference);
        setThemeState(resolved);
        applyTheme(resolved);
        await ConfigStorage.set('theme', newPreference);
      } catch (error) {
        console.error('Failed to save theme:', error);
        setPreferenceState(prev);
        const resolved = resolveTheme(prev);
        setThemeState(resolved);
        applyTheme(resolved);
      }
    },
    [preference]
  );

  // Initialize theme state from the early initialization
  useEffect(() => {
    if (initialThemePromise) {
      initialThemePromise
        .then((pref) => {
          setPreferenceState(pref);
          setThemeState(resolveTheme(pref));
        })
        .catch((error) => {
          console.error('Failed to initialize theme:', error);
        });
    }
  }, []);

  // Listen for system color scheme changes when preference is 'system'
  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const resolved = resolveTheme('system');
      setThemeState(resolved);
      applyTheme(resolved);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    return ipcBridge.application.toggleTheme.on(() => {
      void setPreference(theme === 'light' ? 'dark' : 'light');
    });
  }, [setPreference, theme]);

  return [theme, preference, setPreference];
};

export default useTheme;
