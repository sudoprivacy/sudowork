/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * User Context - 用户上下文获取
 *
 * 从 ConfigStorage 获取用户信息 (user_id, org_id, tenant_id, login_mode)
 *
 * 企业模式和个人模式的用户信息存储位置不同：
 * - 企业模式: eeclaw.userInfo (ConfigStorage) + JWT payload
 * - 个人模式: consumer.userInfo (ConfigStorage)
 */

import { app } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ProcessConfig } from '../initStorage';
import { mainLog, mainWarn } from '../utils/mainLogger';
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

/**
 * 获取用户上下文信息
 *
 * 根据登录模式从不同位置获取用户信息：
 * - 企业模式: eeclaw.userInfo (ConfigStorage) + JWT payload
 * - 个人模式: consumer.userInfo (ConfigStorage)
 *
 * 数据来源：
 * - user_id:
 *   - 企业模式: eeclaw.userInfo.id
 *   - 个人模式: consumer.userInfo.id
 * - org_id: JWT payload 中的 org_id/orgId (仅企业模式)
 * - tenant_id: JWT payload 中的 tenant_id/tenantId (仅企业模式)
 * - login_mode: 根据 appMode ('e' = enterprise, 'c' = personal) 确定
 */
export function getUserContext(): UserContext {
  try {
    // 获取应用模式 (企业/个人)
    const appMode = ProcessConfig.getSync('system.appMode') as 'c' | 'e' | undefined;

    // 根据应用模式确定登录模式
    const login_mode: LoginMode = appMode === 'e' ? 'enterprise' : 'personal';

    let user_id: string | undefined;
    let org_id: string | undefined;
    let tenant_id: string | undefined;
    let user_nickname: string | undefined;
    let user_phone: string | undefined;

    // 企业模式: 从 eeclaw.userInfo 获取用户 ID
    if (appMode === 'e') {
      const userInfo = ProcessConfig.getSync('eeclaw.userInfo') as { id?: string; username?: string; role?: string } | undefined;
      user_id = normalizeString(userInfo?.id);
      user_nickname = normalizeString(userInfo?.username); // 企业模式用 username 作为 nickname
      mainLog(TAG, `[DEBUG] Enterprise mode - userInfo from ConfigStorage: ${JSON.stringify(userInfo)}`);

      // 企业模式: 从 JWT token 解析 org_id 和 tenant_id
      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      if (authStorage?.access_token) {
        const payload = parseJwtPayload(authStorage.access_token);
        mainLog(TAG, `[DEBUG] Enterprise JWT payload: ${JSON.stringify(payload)}`);
        if (payload) {
          org_id = normalizeString(payload.org_id) || normalizeString(payload.orgId);
          tenant_id = normalizeString(payload.tenant_id) || normalizeString(payload.tenantId);
        }
      }
    }

    // 个人模式: 从 consumer.userInfo 获取用户 ID
    if (appMode === 'c' || !user_id) {
      const consumerUserInfo = ProcessConfig.getSync('consumer.userInfo') as { id?: string; nickname?: string; phone?: string; tenant_id?: string } | undefined;
      user_id = normalizeString(consumerUserInfo?.id) || readConsumerUserIdFromFile();
      user_nickname = normalizeString(consumerUserInfo?.nickname);
      user_phone = normalizeString(consumerUserInfo?.phone);
      tenant_id = normalizeString(consumerUserInfo?.tenant_id); // 个人模式下也可能有 tenant_id

      // 个人模式下，org_id 应为空
      org_id = undefined;
    }

    if (!user_id) {
      mainWarn(TAG, `User context not resolved: appMode=${appMode}, login_mode=${login_mode}`);
    }

    return {
      user_id,
      org_id,
      tenant_id,
      login_mode,
      user_nickname,
      user_phone,
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
