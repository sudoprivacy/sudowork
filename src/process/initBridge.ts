/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { cronService } from '@process/services/cron/CronService';
import { teamService } from '@process/services/team/TeamService';
import { mainWarn, mainLog } from '@process/utils/mainLogger';
import { refreshEnterpriseCache } from '@/common/enterpriseDebugConfig';
import { initAllBridges } from './bridge';

logger.config({ print: true });

// 初始化所有 IPC 桥接
initAllBridges();

// Refresh enterprise config cache on startup
// 启动时刷新企业配置缓存
void (async () => {
  await refreshEnterpriseCache();
  mainLog('initBridge', 'Enterprise config cache refreshed');
})();

// Initialize cron service in all modes
// CronService depends on local SQLite, local agents — now available in enterprise mode too
void (async () => {
  void cronService.init().catch((error) => {
    mainWarn('initBridge', 'CronService initialization failed:', error.message);
  });
  void teamService.init().catch((error) => {
    mainWarn('initBridge', 'TeamService initialization failed:', error.message);
  });
})();
