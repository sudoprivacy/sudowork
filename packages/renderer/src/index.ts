/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import './bootstrap/runtimePatches';
import './bootstrap/crashHandler';
import './bootstrap/devTriggers';
import type { PropsWithChildren } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { ConfigProvider } from '@arco-design/web-react';
import '@arco-design/web-react/es/_util/react-19-adapter';
import '@arco-design/web-react/dist/css/arco.css';
import enUS from '@arco-design/web-react/es/locale/en-US';
import jaJP from '@arco-design/web-react/es/locale/ja-JP';
import koKR from '@arco-design/web-react/es/locale/ko-KR';
import zhCN from '@arco-design/web-react/es/locale/zh-CN';
import zhTW from '@arco-design/web-react/es/locale/zh-TW';
import { migrateLocalStorageKeys } from '@sudowork/common/storageKeys';
import '@icon-park/react/styles/index.css';
import 'uno.css';
import './adapter/browser';
import Main from '@renderer/main';
import { AuthProvider } from '@renderer/context/AuthContext';
import { DashboardStatsProvider } from '@renderer/context/DashboardStatsContext';
import { TenantConfigProvider } from '@renderer/context/TenantConfigContext';
import { ThemeProvider, useThemeContext } from '@renderer/context/ThemeContext';
import { ConversationTabsProvider } from '@renderer/pages/conversation/context/ConversationTabsContext';
import { PreviewProvider } from '@renderer/pages/conversation/preview/context/PreviewContext';
import { InitProvider } from '@renderer/context/InitContext';
import '@renderer/i18n';
import HOC from '@renderer/utils/HOC';
import '@renderer/styles/index.css';
import './styles/arco-override.scss';

// One-time migration of legacy 'aionui_*' localStorage keys to 'sudowork_*'
migrateLocalStorageKeys();
const root = createRoot(document.getElementById('root'));

// Patch Korean locale with missing properties from English locale
const koKRComplete = {
  ...koKR,
  Calendar: {
    ...koKR.Calendar,
    monthFormat: enUS.Calendar.monthFormat,
    yearFormat: enUS.Calendar.yearFormat,
  },
  DatePicker: {
    ...koKR.DatePicker,
    Calendar: {
      ...koKR.DatePicker.Calendar,
      monthFormat: enUS.Calendar.monthFormat,
      yearFormat: enUS.Calendar.yearFormat,
    },
  },
  Form: enUS.Form,
  ColorPicker: enUS.ColorPicker,
};

const arcoLocales: Record<string, typeof enUS> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKRComplete,
  'en-US': enUS,
};

const AppProviders: React.FC<PropsWithChildren> = ({ children }) =>
  React.createElement(
    InitProvider,
    null,
    React.createElement(AuthProvider, null, React.createElement(DashboardStatsProvider, null, React.createElement(TenantConfigProvider, null, React.createElement(ThemeProvider, null, React.createElement(PreviewProvider, null, React.createElement(ConversationTabsProvider, null, children))))))
  );

const Config: React.FC<PropsWithChildren> = ({ children }) => {
  const {
    i18n: { language },
  } = useTranslation();
  const { theme } = useThemeContext();
  const arcoLocale = arcoLocales[language] ?? enUS;
  const primaryColor = theme === 'dark' ? '#ea580c' : '#f97316';
  // Buttons default to pill/round shape app-wide; pass `shape` per-button to override.
  return React.createElement(ConfigProvider, { theme: { primaryColor }, locale: arcoLocale, componentConfig: { Button: { shape: 'round' } } }, children);
};

const App = HOC.Wrapper(Config)(Main);

root.render(React.createElement(AppProviders, null, React.createElement(App)));
