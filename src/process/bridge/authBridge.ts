/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, clearCachedCredentialFile, Config, getOauthInfoWithCache, loginWithOauth, Storage } from '@office-ai/aioncli-core';
import { ipcBridge } from '../../common';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { getDataPath } from '../utils';
import { mainLog, mainWarn, mainError, mainDebug } from '@process/utils/mainLogger';
import { userBreadcrumbs } from '@process/telemetry/BreadcrumbTracker';

export function initAuthBridge(): void {
  ipcBridge.googleAuth.status.provider(async ({ proxy }) => {
    try {
      const credsPath = Storage.getOAuthCredsPath();
      if (!fs.existsSync(credsPath)) {
        // 凭证文件不存在时直接返回，避免触发底层 ENOENT 日志
        // Return early when credential file is missing to avoid noisy ENOENT logs
        return { success: false };
      }

      // 首先尝试从缓存获取用户信息
      // First try to get user info from cache
      const info = await getOauthInfoWithCache(proxy);

      if (info) return { success: true, data: { account: info.email } };

      // 如果缓存获取失败，检查凭证文件是否存在
      // If cache retrieval failed, check if credential file exists
      // 这种情况可能是：终端已登录但 google_accounts.json 的 active 为 null
      // This can happen when: terminal is logged in but google_accounts.json has active: null
      try {
        // 凭证文件存在但 getOauthInfoWithCache 失败，可能是令牌需要刷新
        // Credentials file exists but getOauthInfoWithCache failed, token may need refresh
        // 读取凭证文件检查是否有 refresh_token
        // Read credentials file to check for refresh_token
        const credsContent = fs.readFileSync(credsPath, 'utf-8');
        const creds = JSON.parse(credsContent);
        if (creds.refresh_token) {
          // 有 refresh_token，凭证有效但可能需要在使用时刷新
          // Has refresh_token, credentials are valid but may need refresh when used
          mainLog('Auth', 'Credentials exist with refresh_token, returning success');
          return { success: true, data: { account: 'Logged in (refresh needed)' } };
        }
      } catch (fsError) {
        // 忽略文件系统错误，继续返回 false
        // Ignore filesystem errors, continue to return false
        mainDebug('Auth', 'Error checking credentials file:', fsError);
      }

      return { success: false };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  // Google OAuth 登录处理器
  // Google OAuth login handler
  ipcBridge.googleAuth.login.provider(async ({ proxy }) => {
    try {
      // 创建配置对象，包含代理设置
      // Create config object with proxy settings
      const config = new Config({
        proxy,
        sessionId: '',
        targetDir: '',
        debugMode: false,
        cwd: '',
        model: '',
      });

      // 执行 OAuth 登录流程
      // Execute OAuth login flow
      // 添加超时机制，防止用户未完成登录导致一直卡住 / Add timeout to prevent hanging if user doesn't complete login
      const timeoutPromise = new Promise<null>((_, reject) => {
        setTimeout(() => reject(new Error('Login timed out after 2 minutes')), 2 * 60 * 1000);
      });

      const client = await Promise.race([loginWithOauth(AuthType.LOGIN_WITH_GOOGLE, config), timeoutPromise]);

      if (client) {
        // 登录成功后，验证凭证是否被正确保存
        // After successful login, verify credentials were saved properly
        try {
          // 短暂延迟确保凭证文件写入完成
          // Brief delay to ensure credential file is written
          await new Promise((resolve) => setTimeout(resolve, 500));

          const oauthInfo = await getOauthInfoWithCache(proxy);
          if (oauthInfo && oauthInfo.email) {
            mainLog('Auth', 'Login successful, account:', oauthInfo.email);
            // Breadcrumb: user login
            userBreadcrumbs.login('google_oauth');
            return { success: true, data: { account: oauthInfo.email } };
          }

          // 凭证获取失败，说明登录流程虽然返回了 client 但凭证未正确保存
          // Credential retrieval failed - login returned client but credentials weren't saved properly
          mainWarn('Auth', 'Login completed but no credentials found');
          return {
            success: false,
            msg: 'Login completed but credentials were not saved. Please try again.',
          };
        } catch (error) {
          mainError('Auth', 'Failed to verify credentials after login:', error);
          return {
            success: false,
            msg: `Login verification failed: ${error.message || error.toString()}`,
          };
        }
      }

      // 登录失败，返回错误信息
      // Login failed, return error message
      return { success: false, msg: 'Login failed: No client returned' };
    } catch (error) {
      // 捕获登录过程中的所有异常，避免未处理的错误导致应用弹窗
      // Catch all exceptions during login to prevent unhandled errors from showing error dialogs
      mainError('Auth', 'Login error:', error);
      return { success: false, msg: error.message || error.toString() };
    }
  });

  ipcBridge.googleAuth.logout.provider(async () => {
    // Breadcrumb: user logout
    userBreadcrumbs.logout();
    return await clearCachedCredentialFile();
  });

  // ==================== User Phone RSA Encryption Storage ====================
  // Store user phone encrypted with fixed RSA public key for skill access
  // Skill reads encrypted content and sends to server for decryption with private key

  const USER_PHONE_FILE = 'user_phone.enc';

  // Fixed RSA public key for encryption
  // 对应的私钥需要线下提供给服务方
  const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAweYioQLeKt9MLVlhwQH6
9f87z77P2qD5CBdztSk8nZwNN/WXAkLvkFEqr896HbUED7e2jgbsDfAvwvD+mENr
c5eFSCRScc/6wilJX4s96Nrwhm4p4DmqJhMZR84K913Z8S1MeDahFTmhn0JbRjg2
NhFWy+oSbXPkaySB0/FE5U9KI+bDpz1Ouw3ttkGW0BfLVKdk667rbaKP7Un/wxP1
f2abKv0cSeZGnrJH30YUHBLNNeCSEB/uKTvlQIBkrW+JBZ1s58TQvkUvlaxh5tNF
qxFOgqau0zyl/3tAReinbkAVaewKJuER7lBNkfG/4lTtIwmCSvQC3wwOohwsEWcF
WQIDAQAB
-----END PUBLIC KEY-----`;

  ipcBridge.sudoworkAuth.getPublicKey.provider(async () => {
    return { success: true, data: RSA_PUBLIC_KEY };
  });

  ipcBridge.sudoworkAuth.saveUserPhone.provider(async ({ phone }) => {
    try {
      const dataPath = getDataPath();
      const filePath = path.join(dataPath, USER_PHONE_FILE);

      // Encrypt phone with fixed RSA public key
      const encrypted = crypto.publicEncrypt(
        {
          key: RSA_PUBLIC_KEY,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(phone, 'utf-8')
      );

      // Save as base64
      await fsPromises.writeFile(filePath, encrypted.toString('base64'), 'utf-8');
      mainLog('Sudowork Auth', 'User phone encrypted and saved');
      return { success: true };
    } catch (error) {
      mainError('Sudowork Auth', 'Failed to save user phone:', error);
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcBridge.sudoworkAuth.getUserPhone.provider(async () => {
    try {
      const dataPath = getDataPath();
      const filePath = path.join(dataPath, USER_PHONE_FILE);
      const encrypted = await fsPromises.readFile(filePath, 'utf-8');
      // Return encrypted content (base64) - skill should send this to server for decryption
      return { success: true, data: encrypted.trim() };
    } catch (error) {
      // File doesn't exist or read error
      return { success: true, data: null };
    }
  });

  ipcBridge.sudoworkAuth.clearUserPhone.provider(async () => {
    try {
      const dataPath = getDataPath();
      const filePath = path.join(dataPath, USER_PHONE_FILE);
      await fsPromises.unlink(filePath);
      mainLog('Sudowork Auth', 'User phone file deleted');
      return { success: true };
    } catch (error) {
      // File doesn't exist, that's fine
      return { success: true };
    }
  });
}
