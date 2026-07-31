/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAvailableModels } from '@/renderer/hooks/useAvailableModels';

/**
 * 是否存在可用模型（仅游客发送前校验用）。复用 useAvailableModels 的单一判定来源
 * （含 Google Auth）。ready 为 false 时（SWR 加载中/失败）一律视为「未确认」→ 由调用方放行，
 * 绝不误拦有模型的已登录用户。
 */
export function useHasAvailableModel(): { hasModel: boolean; ready: boolean } {
  const { modelList, ready } = useAvailableModels();
  return { hasModel: modelList.length > 0, ready };
}
