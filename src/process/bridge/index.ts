/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { acpDetector } from '@/agent/acp/AcpDetector';
import { initAcpConversationBridge } from './acpConversationBridge';
import { initApplicationBridge } from './applicationBridge';
import { initAuthBridge } from './authBridge';
import { initBedrockBridge } from './bedrockBridge';
import { initChannelBridge } from './channelBridge';
import { initConversationBridge } from './conversationBridge';
import { initCronBridge } from './cronBridge';
import { initDatabaseBridge } from './databaseBridge';
import { mainError } from '@process/utils/mainLogger';
import { initDialogBridge } from './dialogBridge';
import { initDocumentBridge } from './documentBridge';
import { initFileWatchBridge } from './fileWatchBridge';
import { initFsBridge } from './fsBridge';
import { initGeminiBridge } from './geminiBridge';
import { initMcpBridge } from './mcpBridge';
import { initMcporterBridge } from './mcporterBridge';
import { initModelBridge } from './modelBridge';
import { initPreviewHistoryBridge } from './previewHistoryBridge';
import { initShellBridge } from './shellBridge';
import { initStarOfficeBridge } from './starOfficeBridge';
import { initOpenClawBridge } from './openclawBridge';
import { initUpdateBridge } from './updateBridge';
import { initWebuiBridge } from './webuiBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initWindowControlsBridge } from './windowControlsBridge';
import { initExtensionsBridge } from './extensionsBridge';
import { initNexusBridge } from './nexusBridge';
import { initClaudeCliBridge } from './claudeCliBridge';
import { initLibreOfficeBridge } from './libreofficeBridge';
import { initSkillHubBridge } from './skillHubBridge';
import { initAssistantHubBridge } from './assistantHubBridge';
import { initSudoclawBridge } from './sudoclawBridge';
import { initInitBridge } from './initBridge';
import { initSudoworkServerBridge } from './sudoworkServerBridge';
import { initNodeRuntimeBridge } from './nodeRuntimeBridge';
import { initSafetyBridge } from './safetyBridge';
import { initBdpanBridge } from './bdpanBridge';
import { initHealthMonitorBridge } from './healthMonitorBridge';
import { initImageGenerationBridge } from './imageGenerationBridge';
import { initSecretBridge } from './secretBridge';
import { initPwdLoginBridge } from './pwdLoginBridge';
import { initWorkspaceBridge } from './workspaceBridge';
import { initTelemetryBridge } from './telemetryBridge';
import { initAuthProxyBridge } from './authProxyBridge';
import { initMossBridge } from './mossBridge';
// Crash bridge is initialized early in src/process/index.ts before storage
// to handle renderer errors during startup
import { initEeclawBridge } from './eeclawBridge';

/**
 * 初始化所有IPC桥接模块
 */
export function initAllBridges(): void {
  // Init bridge must be first to respond to status queries during installation
  initInitBridge();
  initDialogBridge();
  initShellBridge();
  initFsBridge();
  initFileWatchBridge();
  initConversationBridge();
  initApplicationBridge();
  // 额外的 Gemini 辅助桥（订阅检测等）需要在对话桥初始化后可用 / extra helpers after core bridges
  initGeminiBridge();
  initBedrockBridge();
  initAcpConversationBridge();
  initAuthBridge();
  initModelBridge();
  initMcpBridge();
  initMcporterBridge();
  initDatabaseBridge();
  initPreviewHistoryBridge();
  initDocumentBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initWebuiBridge();
  initChannelBridge();
  initCronBridge();
  initSystemSettingsBridge();
  initExtensionsBridge();
  initStarOfficeBridge();
  initOpenClawBridge();
  initNexusBridge();
  initClaudeCliBridge();
  initLibreOfficeBridge();
  initSkillHubBridge();
  initAssistantHubBridge();
  initSudoclawBridge();
  initNodeRuntimeBridge();
  initSudoworkServerBridge();
  initSafetyBridge();
  initBdpanBridge();
  initHealthMonitorBridge();
  initImageGenerationBridge();
  initSecretBridge();
  initAuthProxyBridge();
  initPwdLoginBridge();
  initWorkspaceBridge();
  initTelemetryBridge();
  initMossBridge();
  // Note: initCrashBridge() is called early in src/process/index.ts before storage
  initEeclawBridge();
}

/**
 * 初始化ACP检测器
 */
export async function initializeAcpDetector(): Promise<void> {
  try {
    await acpDetector.initialize();
  } catch (error) {
    mainError('ACP', 'Failed to initialize detector:', error);
  }
}

// 导出初始化函数供单独使用

export { initAcpConversationBridge, initApplicationBridge, initAssistantHubBridge, initAuthBridge, initBedrockBridge, initChannelBridge, initConversationBridge, initCronBridge, initDatabaseBridge, initDialogBridge, initDocumentBridge, initExtensionsBridge, initFsBridge, initGeminiBridge, initMcpBridge, initModelBridge, initNexusBridge, initPreviewHistoryBridge, initShellBridge, initSkillHubBridge, initStarOfficeBridge, initSudoclawBridge, initSystemSettingsBridge, initUpdateBridge, initWebuiBridge, initWindowControlsBridge };

// 导出窗口控制相关工具函数
export { registerWindowMaximizeListeners } from './windowControlsBridge';
