/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { decryptString, encryptString, encryptCredentials, decryptCredentials } from '@/channels/utils/credentialCrypto';

describe('Credential Crypto', () => {
  describe('encryptString / decryptString', () => {
    it('should encrypt and decrypt a string correctly', () => {
      const plaintext = '123456:ABC-DEF-GHI-JKL-MNOPQRSTUVWXYZ';
      const encrypted = encryptString(plaintext);
      expect(encrypted).toContain('b64:');
      const decrypted = decryptString(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty string', () => {
      expect(encryptString('')).toBe('');
      expect(decryptString('')).toBe('');
    });

    it('should handle legacy plain: prefix', () => {
      const legacy = 'plain:legacy-value';
      expect(decryptString(legacy)).toBe('legacy-value');
    });

    it('should handle legacy enc: prefix', () => {
      const legacy = 'enc:bGVnYWN5LXZhbHVl';
      expect(decryptString(legacy)).toBe('legacy-value');
    });

    it('should return legacy unprefixed values as-is', () => {
      const legacy = 'unprefixed-value';
      expect(decryptString(legacy)).toBe(legacy);
    });

    it('should return garbage for invalid base64 in b64: prefix', () => {
      // Note: Buffer.from with 'base64' returns garbage for invalid base64, not empty string
      const invalid = 'b64:!!!invalid-base64!!!';
      const result = decryptString(invalid);
      // The result is garbage but not empty string
      expect(result).not.toBe('');
    });
  });

  describe('encryptCredentials / decryptCredentials', () => {
    it('should encrypt only token field in credentials', () => {
      const credentials = {
        token: 'telegram-token-123',
        appId: 'lark-app-id',
        appSecret: 'lark-secret-456',
      };
      const encrypted = encryptCredentials(credentials);

      // Token should be encrypted
      expect(encrypted?.token).toContain('b64:');
      // Other fields should remain unchanged
      expect(encrypted?.appId).toBe('lark-app-id');
      expect(encrypted?.appSecret).toBe('lark-secret-456');
    });

    it('should decrypt only token field in credentials', () => {
      const credentials = {
        token: 'b64:dGVsZWdyYW0tdG9rZW4tMTIz', // base64 encoded
        appId: 'lark-app-id',
        appSecret: 'lark-secret-456',
      };
      const decrypted = decryptCredentials(credentials);

      // Token should be decrypted
      expect(decrypted?.token).toBe('telegram-token-123');
      // Other fields should remain unchanged
      expect(decrypted?.appId).toBe('lark-app-id');
      expect(decrypted?.appSecret).toBe('lark-secret-456');
    });

    it('should handle undefined credentials', () => {
      expect(encryptCredentials(undefined)).toBeUndefined();
      expect(decryptCredentials(undefined)).toBeUndefined();
    });

    it('should handle empty credentials', () => {
      const empty = {};
      expect(encryptCredentials(empty)).toEqual({});
      expect(decryptCredentials(empty)).toEqual({});
    });

    it('should handle credentials with only non-token fields', () => {
      const credentials = {
        appId: 'lark-app-id',
        clientId: 'dingtalk-client-id',
      };
      const encrypted = encryptCredentials(credentials);
      expect(encrypted?.appId).toBe('lark-app-id');
      expect(encrypted?.clientId).toBe('dingtalk-client-id');
    });

    it('should handle Lark credentials (appId, appSecret, encryptKey, verificationToken)', () => {
      const larkCredentials = {
        appId: 'cli_1234567890',
        appSecret: 'secret_abcdefghijk',
        encryptKey: 'optional_encrypt_key',
        verificationToken: 'optional_verify_token',
      };
      const encrypted = encryptCredentials(larkCredentials);

      // These fields should not be encrypted (as per current implementation)
      expect(encrypted?.appId).toBe('cli_1234567890');
      expect(encrypted?.appSecret).toBe('secret_abcdefghijk');
      expect(encrypted?.encryptKey).toBe('optional_encrypt_key');
      expect(encrypted?.verificationToken).toBe('optional_verify_token');
    });

    it('should handle DingTalk credentials (clientId, clientSecret)', () => {
      const dingtalkCredentials = {
        clientId: 'dingclient123',
        clientSecret: 'dingsecret456',
      };
      const encrypted = encryptCredentials(dingtalkCredentials);

      // These fields should not be encrypted (as per current implementation)
      expect(encrypted?.clientId).toBe('dingclient123');
      expect(encrypted?.clientSecret).toBe('dingsecret456');
    });

    it('should handle WeChat credentials (token, accountId)', () => {
      const wechatCredentials = {
        token: 'wechat-token-789',
        accountId: 'wechat-account-456',
      };
      const encrypted = encryptCredentials(wechatCredentials);

      // Token should be encrypted
      expect(encrypted?.token).toContain('b64:');
      // accountId should not be encrypted
      expect(encrypted?.accountId).toBe('wechat-account-456');
    });
  });
});
