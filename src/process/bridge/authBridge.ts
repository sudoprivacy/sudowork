/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { getDataPath } from '../utils';
import { ipcBridge } from '../../common';
import { updateUserMdUsernameStatement, updateIdentityMdName } from '../services/sudoclaw/SudoclawInstallService';

export function initAuthBridge(): void {
  // ==================== User Phone RSA Encryption Storage ====================
  // Store user phone encrypted with fixed RSA public key for skill access
  // Skill reads encrypted content and sends to server for decryption with private key

  const USER_PHONE_FILE = 'user_phone.enc';
  const USER_NICKNAME_FILE = 'user_nickname.txt';

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
    } catch {
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
    } catch {
      // File doesn't exist, that's fine
      return { success: true };
    }
  });

  // ==================== User Nickname Storage ====================
  // Store user nickname and sync to USER.md for AI addressing

  ipcBridge.sudoworkAuth.saveUserNickname.provider(async ({ nickname }) => {
    try {
      const dataPath = getDataPath();
      const filePath = path.join(dataPath, USER_NICKNAME_FILE);
      await fsPromises.writeFile(filePath, nickname, 'utf-8');

      // Sync to USER.md for AI addressing
      updateUserMdUsernameStatement(nickname);

      // Sync to IDENTITY.md Name field with assistant name
      updateIdentityMdName('SudoClaw');

      mainLog('Sudowork Auth', 'User nickname saved, USER.md and IDENTITY.md updated');
      return { success: true };
    } catch (error) {
      mainError('Sudowork Auth', 'Failed to save user nickname:', error);
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcBridge.sudoworkAuth.getUserNickname.provider(async () => {
    try {
      const dataPath = getDataPath();
      const filePath = path.join(dataPath, USER_NICKNAME_FILE);
      const nickname = await fsPromises.readFile(filePath, 'utf-8');
      return { success: true, data: nickname.trim() };
    } catch {
      return { success: true, data: null };
    }
  });

  // ==================== Consumer Mode User ID Storage ====================
  // Store consumer mode user ID for telemetry reporting

  const CONSUMER_USER_ID_FILE = 'consumer_user_id.txt';

  ipcBridge.sudoworkAuth.saveConsumerUserId.provider(async ({ userId }) => {
    try {
      const dataPath = getDataPath();
      const filePath = path.join(dataPath, CONSUMER_USER_ID_FILE);
      await fsPromises.writeFile(filePath, String(userId), 'utf-8');
      mainLog('Sudowork Auth', 'Consumer user ID saved');
      return { success: true };
    } catch (error) {
      mainError('Sudowork Auth', 'Failed to save consumer user ID:', error);
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcBridge.sudoworkAuth.getConsumerUserId.provider(async () => {
    try {
      const dataPath = getDataPath();
      const filePath = path.join(dataPath, CONSUMER_USER_ID_FILE);
      const userId = await fsPromises.readFile(filePath, 'utf-8');
      return { success: true, data: userId.trim() };
    } catch {
      return { success: true, data: null };
    }
  });

  ipcBridge.sudoworkAuth.clearConsumerUserId.provider(async () => {
    try {
      const dataPath = getDataPath();
      const filePath = path.join(dataPath, CONSUMER_USER_ID_FILE);
      await fsPromises.unlink(filePath);
      mainLog('Sudowork Auth', 'Consumer user ID file deleted');
      return { success: true };
    } catch {
      // File doesn't exist, that's fine
      return { success: true };
    }
  });
}
