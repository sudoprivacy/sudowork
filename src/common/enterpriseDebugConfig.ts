/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from './storage';

/**
 * Temporary debug configuration - for parallel development
 *
 * TODO: Replace when merging with official implementation:
 * - isEnterpriseMode() → Use eeclawMode.ts from colleagues
 * - getAuthToken() → Use auth service from login colleagues
 */

// ========== Debug switches ==========

/** Whether to enable enterprise mode debug (B-side mode) */
export const DEBUG_ENTERPRISE_MODE = true; // Set to true for debugging, false when merging

/** Moss Server address */
export const DEBUG_MOSS_SERVER_URL = 'http://172.16.30.49:43127';

/** Debug auth token (get from Moss Server or Admin UI) */
export const DEBUG_AUTH_TOKEN = 'moss_sk_430f2bbd-ba95-4d9a-a8ea-35bacc09f47d.HYz15dqFFO3-fQ5jDcSM-5lK0zw3Neaq';

/** Debug username for password login (optional) */
export const DEBUG_USERNAME = '';

/** Debug password for password login (optional) */
export const DEBUG_PASSWORD = '';

// ========== Auth mode selection ==========

/** Auth mode: 'api_key' | 'password' | 'access_token' */
export type AuthMode = 'api_key' | 'password' | 'access_token';

/**
 * Get current auth mode based on available credentials
 */
export function getAuthMode(): AuthMode {
  if (DEBUG_AUTH_TOKEN && DEBUG_AUTH_TOKEN.startsWith('eyJ')) {
    return 'access_token';
  }
  if (DEBUG_AUTH_TOKEN && DEBUG_AUTH_TOKEN.startsWith('moss_sk_')) {
    return 'api_key';
  }
  if (DEBUG_USERNAME && DEBUG_PASSWORD) {
    return 'password';
  }
  return 'api_key'; // Default fallback
}

// ========== Debug config getter methods ==========

/**
 * Temporary: Check if enterprise mode
 *
 * TODO: Replace with eeclawMode.isEnterpriseMode()
 */
export async function isEnterpriseModeAsync(): Promise<boolean> {
  // During debugging, return true directly to skip local mode
  if (DEBUG_ENTERPRISE_MODE) {
    return true;
  }

  // After merge, use official check
  // return eeclawMode.isEnterpriseMode();

  // Temporary fallback: check config
  try {
    const config = await ConfigStorage.get('sudowork.server');
    return !!config?.enterpriseCode;
  } catch {
    return false;
  }
}

/**
 * Synchronous version for cases where async is not available
 */
export function isEnterpriseMode(): boolean {
  // During debugging, return true directly
  if (DEBUG_ENTERPRISE_MODE) {
    return true;
  }
  return false;
}

/**
 * Temporary: Get auth token
 *
 * TODO: Replace with authService.getToken()
 */
export async function getAuthTokenAsync(): Promise<string> {
  // During debugging, return hardcode token
  if (DEBUG_ENTERPRISE_MODE && DEBUG_AUTH_TOKEN) {
    return DEBUG_AUTH_TOKEN;
  }

  // After merge, use official auth
  // return authService.getToken();

  // Temporary fallback: read from config
  try {
    const config = await ConfigStorage.get('enterprise.config' as any);
    return config?.authToken || '';
  } catch {
    return '';
  }
}

/**
 * Synchronous version
 */
export function getAuthToken(): string {
  // During debugging, return hardcode token
  if (DEBUG_ENTERPRISE_MODE && DEBUG_AUTH_TOKEN) {
    return DEBUG_AUTH_TOKEN;
  }
  return '';
}

/**
 * Temporary: Get Moss Server URL
 *
 * TODO: Read from enterprise config
 */
export async function getMossServerUrlAsync(): Promise<string> {
  // During debugging, return hardcode URL
  if (DEBUG_ENTERPRISE_MODE && DEBUG_MOSS_SERVER_URL) {
    return DEBUG_MOSS_SERVER_URL;
  }

  // After merge, read from official config
  try {
    const config = await ConfigStorage.get('enterprise.config' as any);
    return config?.mossServerUrl || 'http://172.16.30.49:43127';
  } catch {
    return 'http://172.16.30.49:43127';
  }
}

/**
 * Synchronous version
 */
export function getMossServerUrl(): string {
  // During debugging, return hardcode URL
  if (DEBUG_ENTERPRISE_MODE && DEBUG_MOSS_SERVER_URL) {
    return DEBUG_MOSS_SERVER_URL;
  }
  return 'http://172.16.30.49:43127';
}

/**
 * Temporary: Get enterprise config
 *
 * TODO: Read from enterprise config
 */
export async function getEnterpriseConfigAsync(): Promise<{
  mossServerUrl: string;
  authToken: string;
  runtimeType?: 'host' | 'docker';
  enterpriseCode?: string;
  orgId?: string;
  userId?: string;
}> {
  return {
    mossServerUrl: await getMossServerUrlAsync(),
    authToken: await getAuthTokenAsync(),
    // runtimeType not specified - Moss Server handles default
    // runtimeType 不指定，Moss Server 处理默认值
  };
}

/**
 * Synchronous version
 */
export function getEnterpriseConfig(): {
  mossServerUrl: string;
  authToken?: string;
  username?: string;
  password?: string;
  authMode: AuthMode;
  runtimeType?: 'host' | 'docker';
  enterpriseCode?: string;
  orgId?: string;
  userId?: string;
} {
  const authMode = getAuthMode();
  return {
    mossServerUrl: getMossServerUrl(),
    authToken: DEBUG_AUTH_TOKEN,
    username: DEBUG_USERNAME,
    password: DEBUG_PASSWORD,
    authMode,
    // runtimeType not specified - Moss Server handles default
    // runtimeType 不指定，Moss Server 处理默认值
  };
}