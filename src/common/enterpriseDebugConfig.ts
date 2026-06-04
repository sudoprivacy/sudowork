/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isEnterpriseMode as eeclawIsEnterpriseMode } from './eeclawMode';

/**
 * Enterprise Configuration for Production Environment
 * 企业模式生产环境配置
 *
 * Uses sudoclaw JWT token directly as request header authentication token.
 * 直接使用 sudoclaw JWT token 作为请求头认证 token。
 *
 * Auth flow (PR #529):
 * 1. Enterprise login via eeclawBridge → returns JWT access_token
 * 2. JWT is stored in 'eeclaw.authStorage' in ProcessConfig
 * 3. Moss API calls use this JWT directly as Bearer token
 *
 * 认证流程（PR #529）：
 * 1. 通过 eeclawBridge 企业登录 → 返回 JWT access_token
 * 2. JWT 存储在 ProcessConfig 的 'eeclaw.authStorage' 中
 * 3. Moss API 调用直接使用此 JWT 作为 Bearer token
 *
 * NOTE: This module is used in both renderer and main process.
 * 注意：此模块在渲染进程和主进程中都使用。
 * In main process, use ProcessConfig.getSync() for synchronous access.
 * 在主进程中，使用 ProcessConfig.getSync() 进行同步访问。
 * In renderer process, use ConfigStorage.get() for async access.
 * 在渲染进程中，使用 ConfigStorage.get() 进行异步访问。
 */

// Cache for synchronous access in main process (updated by refreshEnterpriseCache)
// 主进程同步访问的缓存（由 refreshEnterpriseCache 更新）
let cachedAppMode: 'c' | 'e' | null = null;
let cachedServerUrl: string = '';
let cachedAuthToken: string = '';
let cachedUserId: string = '';
let cachedLocalModeAvailable: boolean | null = null;
// Cache for guid session mode (remote/local), updated by refreshEnterpriseCache and setSessionMode IPC
// guid session 模式缓存（remote/local），由 refreshEnterpriseCache 和 setSessionMode IPC 更新
let cachedSessionMode: 'remote' | 'local' = 'remote';

// Dynamic import for ProcessConfig (main process only)
// ProcessConfig 的动态导入（仅主进程）
let ProcessConfig: typeof import('@process/initStorage').ProcessConfig | null = null;

/**
 * Get ProcessConfig instance (main process only)
 * 获取 ProcessConfig 实例（仅主进程）
 */
async function getProcessConfig(): Promise<typeof import('@process/initStorage').ProcessConfig> {
  if (!ProcessConfig) {
    ProcessConfig = await import('@process/initStorage').then((m) => m.ProcessConfig);
  }
  return ProcessConfig;
}

/**
 * Update cache from async config (called by main process on init)
 * 从异步配置更新缓存（主进程初始化时调用）
 */
export async function refreshEnterpriseCache(): Promise<void> {
  try {
    const config = await getProcessConfig();
    const appMode = config.getSync('system.appMode');
    cachedAppMode = appMode === 'c' || appMode === 'e' ? appMode : null;
    const authStorage = config.getSync('eeclaw.authStorage');
    cachedAuthToken = authStorage?.access_token || '';
    cachedServerUrl = config.getSync('eeclaw.serverUrl') || '';
    cachedSessionMode = config.getSync('guid.sessionMode') || 'remote';
    const localModeAvailable = config.getSync('eeclaw.localModeAvailable');
    cachedLocalModeAvailable = typeof localModeAvailable === 'boolean' ? localModeAvailable : null;
    const userInfo = config.getSync('eeclaw.userInfo');
    if (userInfo?.id) {
      cachedUserId = userInfo.id;
    }
  } catch {
    // Keep existing cache values on error
  }
}

/**
 * Check if the app is in enterprise mode
 * 检查是否为企业模式
 */
export async function isEnterpriseModeAsync(): Promise<boolean> {
  return eeclawIsEnterpriseMode();
}

/**
 * Synchronous version for cases where async is not available
 * 同步版本（用于无法使用 async 的场景）
 *
 * Note: Uses cached value, may not be immediately accurate after mode change
 * 注意：使用缓存值，模式变更后可能不是立即准确
 */
export function isEnterpriseMode(): boolean {
  // Return cached value if available
  // 如果有缓存值则返回
  if (cachedAppMode !== null) {
    return cachedAppMode === 'e';
  }

  // Try to use ProcessConfig.getSync if available (main process)
  // 尝试使用 ProcessConfig.getSync（主进程）
  try {
    // This will only work in main process where ProcessConfig is available
    // 这只在主进程中有效，因为 ProcessConfig 可用
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const processConfig = require('@process/initStorage').ProcessConfig;
    if (processConfig && processConfig.getSync) {
      const mode = processConfig.getSync('system.appMode');
      if (mode) {
        cachedAppMode = mode;
        return mode === 'e';
      }
    }
  } catch {
    // ProcessConfig not available (renderer process)
  }

  return false;
}

/**
 * Return only the already-initialized app mode cache.
 *
 * Data-root selection uses this function instead of isEnterpriseMode() so it
 * never falls back to ProcessConfig while ProcessConfig itself is being built.
 */
export function getCachedAppMode(): 'c' | 'e' | null {
  return cachedAppMode;
}

/**
 * Set the cached app mode (called by main process on mode change)
 * 设置缓存的应用模式（模式变更时由主进程调用）
 */
export function setCachedAppMode(mode: 'c' | 'e'): void {
  cachedAppMode = mode;
}

/**
 * Set the cached auth token (called by main process after login)
 * 设置缓存的认证 token（登录后由主进程调用）
 */
export function setCachedAuthToken(token: string): void {
  cachedAuthToken = token;
}

/**
 * Set the cached server URL (called by main process after config)
 * 设置缓存的服务器 URL（配置后由主进程调用）
 */
export function setCachedServerUrl(url: string): void {
  cachedServerUrl = url;
}

/**
 * Get enterprise auth token (JWT access_token from eeclaw auth storage)
 * 获取企业认证 token（eeclaw auth storage 中的 JWT access_token）
 */
export async function getAuthTokenAsync(): Promise<string> {
  try {
    const config = await getProcessConfig();
    const authStorage = config.getSync('eeclaw.authStorage');
    if (authStorage && authStorage.access_token) {
      return authStorage.access_token;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Synchronous version (uses cached value)
 * 同步版本（使用缓存值）
 */
export function getAuthToken(): string {
  return cachedAuthToken;
}

/**
 * Get Moss Server URL from enterprise config
 * 从企业配置获取 Moss Server URL
 */
export async function getMossServerUrlAsync(): Promise<string> {
  try {
    const config = await getProcessConfig();
    const serverUrl = config.getSync('eeclaw.serverUrl');
    if (serverUrl) {
      return serverUrl;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Get cached user ID (synchronous, uses cached value)
 * 获取缓存的用户 ID（同步，使用缓存值）
 */
export function getUserId(): string {
  return cachedUserId;
}

/**
 * Set cached user ID
 * 设置缓存的用户 ID
 */
export function setCachedUserId(id: string): void {
  cachedUserId = id;
}

/**
 * Get cached enterprise local-mode availability.
 * Returns null when the current login payload did not include this information.
 */
export function getCachedLocalModeAvailable(): boolean | null {
  return cachedLocalModeAvailable;
}

/**
 * Set cached enterprise local-mode availability.
 */
export function setCachedLocalModeAvailable(available: boolean | null): void {
  cachedLocalModeAvailable = available;
}

/**
 * Synchronous version (uses cached value)
 * 同步版本（使用缓存值）
 */
export function getMossServerUrl(): string {
  return cachedServerUrl;
}

/**
 * Get enterprise config for provider initialization
 * 获取企业配置用于 Provider 初始化
 */
export async function getEnterpriseConfigAsync(): Promise<{
  mossServerUrl: string;
  authToken: string;
  runtimeType?: 'host' | 'docker';
}> {
  return {
    mossServerUrl: await getMossServerUrlAsync(),
    authToken: await getAuthTokenAsync(),
    // runtimeType not specified - Moss Server handles default
    // runtimeType 不指定，Moss Server 处理默认值
  };
}

/**
 * Synchronous version for provider initialization
 * 同步版本用于 Provider 初始化
 */
export function getEnterpriseConfig(): {
  mossServerUrl: string;
  authToken: string;
} {
  return {
    mossServerUrl: cachedServerUrl,
    authToken: cachedAuthToken,
  };
}

/**
 * Get cached session mode (remote/local) for enterprise mode
 * 获取缓存的 session 模式（remote/local），用于企业模式
 */
export function getCachedSessionMode(): 'remote' | 'local' {
  return cachedSessionMode;
}

/**
 * Set cached session mode (called by setSessionMode IPC handler)
 * 设置缓存的 session 模式（由 setSessionMode IPC handler 调用）
 */
export function setCachedSessionMode(mode: 'remote' | 'local'): void {
  cachedSessionMode = mode;
}
