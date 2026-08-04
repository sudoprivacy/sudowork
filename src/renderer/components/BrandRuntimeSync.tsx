/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, type ReactElement } from 'react';
import i18n from '@/renderer/i18n';
import { useTenantStore } from '@/renderer/stores/useTenantStore';

/**
 * 将响应式运行时品牌同步到无法直接订阅 Zustand Store 的浏览器级消费者：
 * 页面标题和 i18next 全局 `appName` 插值变量。
 */
export default function BrandRuntimeSync(): ReactElement | null {
  const appName = useTenantStore((state) => state.appName);
  const topName = useTenantStore((state) => state.topName);

  useEffect(() => {
    document.title = topName;
    i18n.options.interpolation = {
      ...i18n.options.interpolation,
      defaultVariables: {
        ...i18n.options.interpolation?.defaultVariables,
        appName,
      },
    };
    i18n.emit('languageChanged', i18n.language);
  }, [appName, topName]);

  return null;
}
