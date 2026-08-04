/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useTenantStore } from '@/renderer/stores/useTenantStore';

/**
 * Whether tool calls are shown in the chat stream.
 * 对话流中是否显示工具调用。
 *
 * Resolution order / 解析顺序:
 * 1. Explicit local override ('system.showToolCalls') — set the first time the
 *    user touches the toggle, wins in both modes.
 *    本地显式覆盖值，用户首次切换开关后写入，两种模式下均优先。
 * 2. Enterprise mode: Moss-managed `client_show_tool_calls` default from the
 *    tenant config (missing/unset → shown).
 *    企业模式：跟随 Moss 租户配置的默认值（未设置视为显示）。
 * 3. Consumer mode: shown.
 *    个人模式：显示。
 */
export function useShowToolCalls(): boolean {
  const { isEnterprise } = useAppMode();
  const clientShowToolCalls = useTenantStore((state) => state.clientShowToolCalls);
  // null = no local override yet (follow default) / null 表示尚无本地覆盖（跟随默认值）
  const [localValue, setLocalValue] = useState<boolean | null>(null);

  useEffect(() => {
    void ipcBridge.systemSettings.getShowToolCalls
      .invoke()
      .then((value) => setLocalValue(value ?? null))
      .catch(() => {});
    return ipcBridge.systemSettings.showToolCallsChanged.on(({ enabled }) => {
      setLocalValue(enabled);
    });
  }, []);

  if (localValue !== null) {
    return localValue;
  }
  // resolveTenantPolicy normalizes this to a boolean (default true).
  return isEnterprise ? clientShowToolCalls : true;
}
