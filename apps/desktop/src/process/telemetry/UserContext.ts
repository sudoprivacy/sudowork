/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Resolve reporting identity from the current Moss session, with a legacy-client fallback. */

import { app } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getSystemConfigCache } from '@sudowork/common/systemConfig';
import { ProcessConfig } from '../initStorage';
import { mainWarn } from '../utils/mainLogger';
import type { LoginMode } from '../../shared/types/telemetry';

const TAG = 'UserContext';
const CONSUMER_USER_ID_FILE = 'consumer_user_id.txt';

export interface UserContext {
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: LoginMode;
  user_nickname?: string;
  user_phone?: string;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function readConsumerUserIdFromFile(): string | undefined {
  try {
    const filePath = path.join(app.getPath('home'), '.nexus', CONSUMER_USER_ID_FILE);
    return normalizeString(readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * 从 JWT access_token 解析 payload
 * JWT 格式: header.payload.signature (Base64)
 */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      mainWarn(TAG, 'Invalid JWT format: expected 3 parts');
      return null;
    }

    // Base64 解码 payload 部分
    const payload = parts[1];
    // 处理 Base64 URL 编码 (替换 - 和 _)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    // 补齐 padding
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');

    return JSON.parse(decoded);
  } catch (error) {
    mainWarn(TAG, 'Failed to parse JWT payload:', error);
    return null;
  }
}

/** Account identity is independent of a task's local or remote execution target. */
export function getUserContext(): UserContext {
  try {
    const auth = ProcessConfig.getSync('eeclaw.authStorage');
    const userInfo = ProcessConfig.getSync('eeclaw.userInfo');
    const configuredTenant = normalizeString(getSystemConfigCache()?.product_improvement?.tenant_id);
    if (auth?.access_token || userInfo) {
      if (!auth?.access_token) return {};
      const payload = parseJwtPayload(auth.access_token);
      const userId = normalizeString(payload?.sub) || normalizeString(userInfo?.id);
      // A stale profile from another account must not label the current principal.
      const isMatchingProfile = userId === normalizeString(userInfo?.id);
      return {
        user_id: userId,
        org_id: normalizeString(payload?.org_id) || normalizeString(payload?.orgId) || (isMatchingProfile ? normalizeString(userInfo?.orgId) : undefined),
        tenant_id: configuredTenant || normalizeString(payload?.tenant_id) || normalizeString(payload?.tenantId),
        user_nickname: isMatchingProfile ? normalizeString(userInfo?.username) : undefined,
      };
    }

    const consumer = ProcessConfig.getSync('consumer.userInfo');
    return {
      user_id: normalizeString(consumer?.id) || readConsumerUserIdFromFile(),
      tenant_id: configuredTenant || normalizeString(consumer?.tenant_id),
      user_nickname: normalizeString(consumer?.nickname),
      user_phone: normalizeString(consumer?.phone),
    };
  } catch (error) {
    mainWarn(TAG, 'Failed to get user context:', error);
    return {};
  }
}

/**
 * 同步获取用户上下文 (用于遥测上报)
 */
export function getUserContextSync(): UserContext {
  return getUserContext();
}

/**
 * 检查用户上下文是否可用
 */
export function hasUserContext(): boolean {
  const ctx = getUserContext();
  return !!ctx.user_id;
}
