/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges } from './bridge';
import { cronService } from '@process/services/cron/CronService';
import { mainWarn, mainLog } from '@process/utils/mainLogger';
import { isEnterpriseMode } from '@/common/eeclawMode';
import { refreshEnterpriseCache } from '@/common/enterpriseDebugConfig';

logger.config({ print: true });

// 初始化所有 IPC 桥接
initAllBridges();

// Refresh enterprise config cache on startup
// 启动时刷新企业配置缓存
(async () => {
  await refreshEnterpriseCache();
  mainLog('initBridge', 'Enterprise config cache refreshed');
})();

// Initialize cron service only in consumer mode
// CronService depends on local SQLite, local agents, local file system — all skipped in enterprise mode
(async () => {
  if (!(await isEnterpriseMode())) {
    void cronService.init().catch((error) => {
      mainWarn('initBridge', 'CronService initialization failed:', error.message);
    });
  }
})();
