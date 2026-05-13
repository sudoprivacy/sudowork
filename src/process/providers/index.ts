/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationProvider, IProviderConfig } from './types';
import { LocalConversationProvider } from './LocalConversationProvider';
import { RemoteConversationProvider } from './RemoteConversationProvider';
import { isEnterpriseMode, getEnterpriseConfig, getCachedSessionMode } from '@/common/enterpriseDebugConfig';
import { mainLog } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/initStorage';

let currentProvider: IConversationProvider | null = null;
let currentProviderType: 'local' | 'remote' | null = null;

export function getConversationProvider(sessionMode?: 'remote' | 'local'): IConversationProvider {
  const isEnterprise = isEnterpriseMode();
  // Determine effective target provider type based on sessionMode parameter or cache
  // 根据 sessionMode 参数或缓存确定有效的目标 Provider 类型
  const effectiveMode = isEnterprise
    ? (sessionMode ?? getCachedSessionMode())
    : 'local'; // C端始终 local
  const targetType: 'local' | 'remote' = effectiveMode === 'remote' ? 'remote' : 'local';

  if (currentProvider && currentProviderType === targetType) {
    return currentProvider;
  }

  if (targetType === 'remote') {
    const config = getEnterpriseConfig();

    // Read the freshest token from ProcessConfig (not from stale memory cache)
    let freshestToken = config.authToken;
    let serverUrl = config.mossServerUrl;
    try {
      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      if (authStorage?.access_token) {
        freshestToken = authStorage.access_token;
      }
      const storedUrl = ProcessConfig.getSync('eeclaw.serverUrl');
      if (storedUrl) {
        serverUrl = storedUrl;
      }
    } catch { /* ignore */ }

    mainLog('Provider', `Using REMOTE provider (Enterprise Mode) - Server: ${serverUrl || 'not set'}, Token: ${freshestToken ? 'set' : 'not set'}`);

    // In enterprise mode with a server URL, always use RemoteConversationProvider
    // even if token is temporarily missing - the provider will trigger token refresh
    if (!serverUrl) {
      mainLog('Provider', 'Enterprise server URL not configured, falling back to LOCAL provider');
      currentProvider = new LocalConversationProvider();
      currentProviderType = 'local';
      return currentProvider;
    }

    currentProvider = new RemoteConversationProvider({
      isEnterpriseMode: true,
      authToken: freshestToken || '',
      mossServerUrl: serverUrl,
    });
    currentProviderType = 'remote';
    return currentProvider;
  }

  mainLog('Provider', 'Using LOCAL provider (Local Mode)');
  currentProvider = new LocalConversationProvider();
  currentProviderType = 'local';
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
export function isRemoteProvider(sessionMode?: 'remote' | 'local'): boolean {
  if (!isEnterpriseMode()) return false;
  if (sessionMode !== undefined) return sessionMode === 'remote';
  return true; // 兼容旧调用方（无参数时保持原行为：E端默认 remote）
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