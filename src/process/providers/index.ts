/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationProvider, IProviderConfig } from './types';
import { LocalConversationProvider } from './LocalConversationProvider';
import { RemoteConversationProvider } from './RemoteConversationProvider';
import { isEnterpriseMode, getEnterpriseConfig } from '@/common/enterpriseDebugConfig';
import { mainLog } from '@process/utils/mainLogger';

// Singleton provider instance / 单例 Provider 实例
let currentProvider: IConversationProvider | null = null;
let currentProviderType: 'local' | 'remote' | null = null;

/**
 * Get the current conversation provider
 * 获取当前的会话 Provider
 *
 * Returns appropriate provider based on enterprise mode:
 * 根据企业模式返回相应的 Provider：
 * - Local mode: LocalConversationProvider (database-backed) / 本地模式：LocalConversationProvider（数据库）
 * - Enterprise mode: RemoteConversationProvider (Moss Server) / 企业模式：RemoteConversationProvider（Moss Server）
 *
 * Provider is cached as singleton - call resetProvider() to switch.
 * Provider 作为单例缓存 - 调用 resetProvider() 来切换。
 */
export function getConversationProvider(): IConversationProvider {
  const isEnterprise = isEnterpriseMode();

  // Return cached provider if type matches / 如果类型匹配，返回缓存的 Provider
  if (currentProvider && currentProviderType === (isEnterprise ? 'remote' : 'local')) {
    return currentProvider;
  }

  // Create new provider / 创建新的 Provider
  if (isEnterprise) {
    const config = getEnterpriseConfig();
    mainLog('Provider', `Using REMOTE provider (Enterprise Mode) - Server: ${config.mossServerUrl || 'not set'}, Token: ${config.authToken ? 'set' : 'not set'}`);

    if (!config.mossServerUrl || !config.authToken) {
      mainLog('Provider', 'Enterprise config incomplete, falling back to LOCAL provider');
      currentProvider = new LocalConversationProvider();
      currentProviderType = 'local';
      return currentProvider;
    }

    currentProvider = new RemoteConversationProvider({
      isEnterpriseMode: true,
      mossServerUrl: config.mossServerUrl,
      authToken: config.authToken,
    });
    currentProviderType = 'remote';
  } else {
    mainLog('Provider', 'Using LOCAL provider (Local Mode)');
    currentProvider = new LocalConversationProvider();
    currentProviderType = 'local';
  }

  return currentProvider;
}

/**
 * Reset the provider singleton
 * 重置 Provider 单例
 *
 * Call this when switching between enterprise and local mode,
 * 在切换企业模式和本地模式时调用此方法，
 * or when authentication config changes.
 * 或当认证配置变更时调用。
 */
export function resetConversationProvider(): void {
  currentProvider = null;
  currentProviderType = null;
  mainLog('Provider', 'Provider reset - will create new instance on next call');
}

/**
 * Check if currently using remote provider
 * 检查当前是否使用远程 Provider
 */
export function isRemoteProvider(): boolean {
  return isEnterpriseMode();
}

/**
 * Get provider type string
 * 获取 Provider 类型字符串
 */
export function getProviderType(): 'local' | 'remote' {
  return isEnterpriseMode() ? 'remote' : 'local';
}

// Re-export types and providers / 重新导出类型和 Provider
export type { IConversationProvider, IProviderConfig } from './types';
export { LocalConversationProvider } from './LocalConversationProvider';
export { RemoteConversationProvider } from './RemoteConversationProvider';