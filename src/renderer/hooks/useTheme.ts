// hooks/useTheme.ts
import { ConfigStorage } from '@/common/storage';
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type ThemePreference = 'light' | 'dark' | 'system';

const DEFAULT_PREFERENCE: ThemePreference = 'light';
const THEME_CACHE_KEY = '__aionui_theme';

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

// Apply theme to document
const applyTheme = (theme: Theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('arco-theme', theme);
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch (_e) {
    /* noop */
  }
};

// Initialize theme immediately when module loads.
// 主题切换入口已移除：强制亮色，并归一旧的 dark/system 偏好。
// Theme switching has been removed: force light and normalize any legacy dark/system preference.
const initTheme = async (): Promise<ThemePreference> => {
  const preference = DEFAULT_PREFERENCE; // always 'light'
  applyTheme(resolveTheme(preference));
  try {
    const saved = (await ConfigStorage.get('theme')) as ThemePreference;
    if (saved !== preference) {
      await ConfigStorage.set('theme', preference);
    }
  } catch (error) {
    console.error('Failed to normalize theme preference:', error);
  }
  return preference;
};

// Run theme initialization immediately
let initialThemePromise: Promise<ThemePreference> | null = null;
if (typeof window !== 'undefined') {
  initialThemePromise = initTheme();
}

const useTheme = (): [Theme, ThemePreference, (preference: ThemePreference) => Promise<void>] => {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_PREFERENCE);
  const [theme, setThemeState] = useState<Theme>(resolveTheme(DEFAULT_PREFERENCE));

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

  return [theme, preference, setPreference];
};

export default useTheme;
