/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { mainLog } from '@process/utils/mainLogger';
import type { ICronProvider } from './types';
import { LocalCronProvider } from './LocalCronProvider';
import { RemoteCronProvider } from './RemoteCronProvider';

/**
 * Get Cron Provider
 * 获取定时任务 Provider
 *
 * Returns the appropriate provider based on:
 * - Non-enterprise mode: always local
 * - Enterprise mode: always remote — scheduled tasks are moss-hosted. The
 *   deprecated enterprise "local" session mode no longer routes cron to the
 *   local store, so ownership/policy enforcement stays server-side.
 *
 * 每次调用都创建新实例，避免 token 过期/用户切换串状态
 */
export function getCronProvider(): ICronProvider {
  const isEnterprise = isEnterpriseMode();

  mainLog('CronProvider', `Provider selected: ${isEnterprise ? 'remote' : 'local'} (enterprise: ${isEnterprise})`);

  if (isEnterprise) {
    return new RemoteCronProvider();
  }
  return new LocalCronProvider();
}

// Re-export types
export type { ICronProvider } from './types';
export { LocalCronProvider } from './LocalCronProvider';
export { RemoteCronProvider } from './RemoteCronProvider';
