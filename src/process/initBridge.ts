/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges } from './bridge';
import { cronService } from '@process/services/cron/CronService';
import { mainWarn } from '@process/utils/mainLogger';
import { isEnterpriseMode } from '@/common/eeclawMode';

logger.config({ print: true });

// 初始化所有 IPC 桥接
initAllBridges();

// Initialize cron service only in consumer mode
// CronService depends on local SQLite, local agents, local file system — all skipped in enterprise mode
(async () => {
  if (!(await isEnterpriseMode())) {
    void cronService.init().catch((error) => {
      mainWarn('initBridge', 'CronService initialization failed:', error.message);
    });
  }
})();
