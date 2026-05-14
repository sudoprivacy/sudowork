/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges } from './bridge';
import { cronService } from '@process/services/cron/CronService';
import { mainWarn, mainLog } from '@process/utils/mainLogger';
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

// Initialize cron service in all modes
// CronService depends on local SQLite, local agents — now available in enterprise mode too
(async () => {
  void cronService.init().catch((error) => {
    mainWarn('initBridge', 'CronService initialization failed:', error.message);
  });
})();
