/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges, initCronBridge } from './bridge';
import { cronService } from '@process/services/cron/CronService';
import { featureFlagService } from '@process/services/featureFlags/FeatureFlagService';
import { mainWarn } from '@process/utils/mainLogger';

logger.config({ print: true });

// 初始化所有 IPC 桥接
initAllBridges();

// Conditionally init cron behind feature flag
void (async () => {
  const cronEnabled = await featureFlagService.isEnabled('cronJobs');
  if (cronEnabled) {
    initCronBridge();
    void cronService.init().catch((error) => {
      mainWarn('initBridge', 'CronService initialization failed:', error.message);
    });
  }
})();
