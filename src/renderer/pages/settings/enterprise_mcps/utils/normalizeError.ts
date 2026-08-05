/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { EnterpriseMcpError } from '../api/client';

export interface NormalizedInstallError {
  code: string;
  message: string;
  /** keys to highlight in the InstallConfigModal (only for `missing_config`) */
  missingKeys?: string[];
}

/**
 * Translate raw install/PATCH errors into the user-facing copy the spec
 * (see §3.4 Install error handling) requires. Falls back to err.message.
 */
export function normalizeInstallError(err: unknown): NormalizedInstallError {
  if (err instanceof EnterpriseMcpError) {
    const base: NormalizedInstallError = {
      code: err.code,
      message: err.message,
    };
    switch (err.code) {
      case 'missing_config':
        return {
          ...base,
          message: '必填配置项缺失，请补充后重试',
          missingKeys: err.missing_keys,
        };
      case 'missing_auth_credentials':
        return {
          ...base,
          message: '必填鉴权凭据缺失，请补充后重试',
          missingKeys: err.missing_keys,
        };
      case 'forbidden':
        return { ...base, message: err.message || '当前策略禁止安装该 MCP' };
      case 'not_found':
        return { ...base, message: '模板不存在或已下架' };
      case 'user_config_unavailable':
        return { ...base, message: '企业密钥服务未就绪，请联系管理员' };
      case 'unauthorized':
        return { ...base, message: '登录已失效，请重新登录' };
      case 'server_url_missing':
        return { ...base, message: '尚未配置企业服务地址' };
      case 'connection_test_failed':
        return { ...base, message: err.message || 'MCP 连接测试失败' };
      case 'name_conflict':
        return { ...base, message: '名称冲突，请重试' };
      case 'bad_request':
        return { ...base, message: err.message || '请求参数错误' };
      default:
        return base;
    }
  }
  return {
    code: 'unknown_error',
    message: err instanceof Error ? err.message : '请求失败',
  };
}

export function describeMcpError(err: unknown): string {
  if (err instanceof EnterpriseMcpError) return err.message;
  if (err instanceof Error) return err.message;
  return '请求失败';
}
