/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import i18n from 'i18next';
import { DEFAULT_LANGUAGE, normalizeLanguageCode, mergeWithFallback, ensureAndSwitch, type LocaleData } from '@sudowork/common/i18n';
import { mainLog, mainError } from '@process/utils/mainLogger';

// Static imports – Vite bundles these into the main-process output so they
// work correctly in both development and production (no fs.readFile needed).
import enUS from '@renderer/i18n/locales/en-US/index';
import zhCN from '@renderer/i18n/locales/zh-CN/index';
import jaJP from '@renderer/i18n/locales/ja-JP/index';
import zhTW from '@renderer/i18n/locales/zh-TW/index';
import koKR from '@renderer/i18n/locales/ko-KR/index';
import trTR from '@renderer/i18n/locales/tr-TR/index';

// All locale data keyed by language code.
// NOTE: When adding a new language, add a static import above and an entry here.
// These MUST be static imports (not dynamic) because the main process is bundled
// by Vite and the JSON files won't exist on disk in production.
const localeData: LocaleData = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'ja-JP': jaJP,
  'zh-TW': zhTW,
  'ko-KR': koKR,
  'tr-TR': trTR,
};

const fallbackData = localeData[DEFAULT_LANGUAGE] ?? {};

function getLocaleModules(locale: string): Record<string, unknown> {
  const data = localeData[locale];
  if (!data) return fallbackData;
  if (locale === DEFAULT_LANGUAGE) return data;
  return mergeWithFallback(fallbackData, data);
}

const initPromise = (async (): Promise<void> => {
  // Detect system language on first run (Windows: use app.getLocale())
  // 首次运行时检测系统语言（Windows：使用 app.getLocale()）
  let detectedLanguage = DEFAULT_LANGUAGE;

  try {
    const { app } = await import('electron');
    const systemLocale = app.getLocale();
    mainLog('Main Process', 'Detected system locale:', systemLocale);
    detectedLanguage = normalizeLanguageCode(systemLocale);
  } catch {
    // Ignore detection errors, use default
  }

  // eslint-disable-next-line import/no-named-as-default-member
  await i18n.init({
    resources: {
      [DEFAULT_LANGUAGE]: { translation: getLocaleModules(DEFAULT_LANGUAGE) },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    debug: false,
    interpolation: { escapeValue: false },
  });

  // Priority: user config > detected system language > default
  // 优先级：用户配置 > 检测的系统语言 > 默认语言
  // 主进程读 language 用本地 fs（ProcessConfig.getSync = configFile），不能用 ConfigStorage.get：
  // 后者是 @office-ai/platform 的 BroadcastChannel RPC，主进程自调会永久 pending（见 initStorage.ts:93 注释）。
  const { ProcessConfig } = await import('@process/initStorage');
  const userLanguage = ProcessConfig.getSync('language');
  const targetLanguage = userLanguage || detectedLanguage;

  if (targetLanguage && targetLanguage !== DEFAULT_LANGUAGE) {
    await ensureAndSwitch(i18n, targetLanguage, getLocaleModules);
    mainLog('Main Process', 'Switched to language:', targetLanguage);
  }
})().catch((error) => {
  mainError('Main Process', 'Failed to initialize i18n:', error);
});

/**
 * 切换语言 / Change language
 *
 * 可以在其他地方调用此函数来切换主进程的语言
 * Can be called from elsewhere to change the main process language
 */
export async function changeLanguage(language: string): Promise<void> {
  await initPromise;
  await ensureAndSwitch(i18n, language, getLocaleModules);
}

/** Resolves once main-process i18n has loaded; await before reading translations at startup. */
export { initPromise as i18nReady };
export { normalizeLanguageCode };
export default i18n;
