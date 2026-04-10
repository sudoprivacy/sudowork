/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { mcporterService } from '@process/services/mcporter';

export function initMcporterBridge(): void {
  // mcporter 服务相关 IPC 处理程序
  ipcBridge.mcporterService.isAvailable.provider(async () => {
    try {
      const result = await mcporterService.isAvailable();
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error checking mcporter availability',
      };
    }
  });

  ipcBridge.mcporterService.install.provider(async () => {
    try {
      await mcporterService.install();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error installing mcporter',
      };
    }
  });

  ipcBridge.mcporterService.syncConfig.provider(async (servers) => {
    try {
      await mcporterService.syncConfig(servers);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error syncing mcporter config',
      };
    }
  });

  ipcBridge.mcporterService.startDaemon.provider(async () => {
    try {
      await mcporterService.startDaemon();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error starting mcporter daemon',
      };
    }
  });

  ipcBridge.mcporterService.stopDaemon.provider(async () => {
    try {
      await mcporterService.stopDaemon();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error stopping mcporter daemon',
      };
    }
  });

  ipcBridge.mcporterService.getDaemonStatus.provider(async () => {
    try {
      const result = await mcporterService.getDaemonStatus();
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error getting mcporter daemon status',
      };
    }
  });

  ipcBridge.mcporterService.getConfigPath.provider(async () => {
    try {
      const result = mcporterService.getConfigPath();
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error getting mcporter config path',
      };
    }
  });

  ipcBridge.mcporterService.initialize.provider(async (servers) => {
    try {
      await mcporterService.initialize(servers);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error initializing mcporter',
      };
    }
  });
}
