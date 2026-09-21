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

// Register the ontology-builder MCP server up-front so every scode session
// spawned during this app run sees the ontology_* write tools. The MCP itself
// only talks HTTP into main-process, so this is cheap and idempotent.
void (async () => {
  try {
    const { ensureOntologyBuilderMcpServer } = await import('@process/services/ontology/OntologyMcpRegistration');
    await ensureOntologyBuilderMcpServer();
    mainLog('initBridge', 'Ontology builder MCP registered with Sudocode');
  } catch (error) {
    mainWarn('initBridge', 'Ontology builder MCP registration failed:', error instanceof Error ? error.message : String(error));
  }
})();
