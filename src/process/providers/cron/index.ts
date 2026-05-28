/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronProvider } from './types';
import { LocalCronProvider } from './LocalCronProvider';
import { RemoteCronProvider } from './RemoteCronProvider';
import { getCachedLocalModeAvailable, getCachedSessionMode, isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { mainLog } from '@process/utils/mainLogger';

/**
 * Get Cron Provider
 * 获取定时任务 Provider
 *
 * Returns the appropriate provider based on:
 * - Non-enterprise mode: always local
 * - Enterprise mode: based on sessionMode setting
 *
 * 每次调用都创建新实例，避免 token 过期/用户切换串状态
 */
export function getCronProvider(): ICronProvider {
  const isEnterprise = isEnterpriseMode();
  let mode = isEnterprise ? getCachedSessionMode() : 'local';
  if (isEnterprise && mode === 'local' && getCachedLocalModeAvailable() === false) {
    mode = 'remote';
  }

  mainLog('CronProvider', `Provider selected: ${mode} (enterprise: ${isEnterprise})`);

  if (mode === 'remote') {
    return new RemoteCronProvider();
  }
  return new LocalCronProvider();
}

// Re-export types
export type { ICronProvider } from './types';
export { LocalCronProvider } from './LocalCronProvider';
export { RemoteCronProvider } from './RemoteCronProvider';
