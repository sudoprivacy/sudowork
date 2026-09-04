/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptAesEcb, encryptAesEcb, generateAesKey, normalizeAesKey, parseAesKey } from '@/channels/plugins/wechat/WeChatCrypto';

/**
 * Helper: encrypt plaintext with AES-128-ECB for testing decryption.
 */
function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

describe('WeChatCrypto', () => {
  describe('parseAesKey', () => {
    it('parses direct base64 key (16 raw bytes)', () => {
      // 16 bytes of raw data -> base64
      const rawKey = Buffer.from('0123456789abcdef'); // 16 bytes
      const base64Key = rawKey.toString('base64');
      const result = parseAesKey(base64Key);
      expect(result).toEqual(rawKey);
      expect(result.length).toBe(16);
    });

    it('parses indirect base64 key (32 hex chars -> 16 bytes)', () => {
      // 32 hex chars as ASCII -> base64
      const hexString = '0123456789abcdef0123456789abcdef'; // 32 hex chars
      const base64Key = Buffer.from(hexString, 'ascii').toString('base64');
      const result = parseAesKey(base64Key);
      expect(result.length).toBe(16);
      expect(result).toEqual(Buffer.from(hexString, 'hex'));
    });

    it('throws for invalid key length', () => {
      const shortKey = Buffer.from('short').toString('base64');
      expect(() => parseAesKey(shortKey)).toThrow('Invalid WeChat AES key');
    });
  });

  describe('normalizeAesKey', () => {
    it('returns null for empty key', () => {
      expect(normalizeAesKey('')).toBeNull();
    });

    it('parses hex-encoded key (ImageItem.aeskey)', () => {
      const hexKey = '0123456789abcdef0123456789abcdef';
      const result = normalizeAesKey(hexKey, true);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(16);
      expect(result).toEqual(Buffer.from(hexKey, 'hex'));
    });

    it('returns null for invalid hex key (wrong length)', () => {
      const shortHex = '0123456789abcdef'; // Only 16 hex chars = 8 bytes
      expect(normalizeAesKey(shortHex, true)).toBeNull();
    });

    it('parses base64-encoded key (media.aes_key)', () => {
      const rawKey = Buffer.from('0123456789abcdef');
      const base64Key = rawKey.toString('base64');
      const result = normalizeAesKey(base64Key, false);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(16);
      expect(result).toEqual(rawKey);
    });

    it('returns null for invalid base64 key', () => {
      // This base64 decodes to 3 bytes, which is neither 16 nor a valid 32-char hex
      const badKey = Buffer.from('bad').toString('base64');
      expect(normalizeAesKey(badKey, false)).toBeNull();
    });
  });

  describe('decryptAesEcb', () => {
    const testKey = Buffer.from('0123456789abcdef'); // 16 bytes

    it('decrypts AES-128-ECB encrypted data', () => {
      const plaintext = Buffer.from('Hello, WeChat media decryption!');
      const ciphertext = encryptAesEcb(plaintext, testKey);

      // Ciphertext should be different from plaintext
      expect(ciphertext).not.toEqual(plaintext);

      // Decrypt should recover original plaintext
      const decrypted = decryptAesEcb(ciphertext, testKey);
      expect(decrypted).toEqual(plaintext);
    });

    it('handles binary data (simulating media files)', () => {
      // Simulate a small binary file (e.g., image header bytes)
      const binaryData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08]);
      const ciphertext = encryptAesEcb(binaryData, testKey);
      const decrypted = decryptAesEcb(ciphertext, testKey);
      expect(decrypted).toEqual(binaryData);
    });

    it('handles empty plaintext (single padding block)', () => {
      const plaintext = Buffer.alloc(0);
      const ciphertext = encryptAesEcb(plaintext, testKey);
      const decrypted = decryptAesEcb(ciphertext, testKey);
      expect(decrypted).toEqual(plaintext);
    });

    it('handles data that is exactly one block (16 bytes)', () => {
      const plaintext = Buffer.from('exactly16bytes!!'); // 16 bytes
      const ciphertext = encryptAesEcb(plaintext, testKey);
      const decrypted = decryptAesEcb(ciphertext, testKey);
      expect(decrypted).toEqual(plaintext);
    });

    it('throws with wrong key', () => {
      const plaintext = Buffer.from('test data');
      const ciphertext = encryptAesEcb(plaintext, testKey);
      const wrongKey = Buffer.from('fedcba9876543210');
      // Decryption with wrong key may produce garbage or throw on invalid padding
      expect(() => decryptAesEcb(ciphertext, wrongKey)).toThrow();
    });
  });

  describe('encryptAesEcb', () => {
    const testKey = Buffer.from('0123456789abcdef'); // 16 bytes

    it('encrypts and decrypts symmetrically', () => {
      const plaintext = Buffer.from('Hello, WeChat!');
      const ciphertext = encryptAesEcb(plaintext, testKey);
      expect(ciphertext).not.toEqual(plaintext);
      expect(decryptAesEcb(ciphertext, testKey)).toEqual(plaintext);
    });

    it('produces ciphertext with PKCS7 padding (length % 16 === 0)', () => {
      const plaintext = Buffer.from('test'); // 4 bytes
      const ciphertext = encryptAesEcb(plaintext, testKey);
      expect(ciphertext.length % 16).toBe(0);
      expect(ciphertext.length).toBe(16); // 4 + 12 padding
    });

    it('handles binary data', () => {
      const binaryData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const ciphertext = encryptAesEcb(binaryData, testKey);
      const decrypted = decryptAesEcb(ciphertext, testKey);
      expect(decrypted).toEqual(binaryData);
    });

    it('handles empty plaintext (single padding block)', () => {
      const plaintext = Buffer.alloc(0);
      const ciphertext = encryptAesEcb(plaintext, testKey);
      expect(ciphertext.length).toBe(16); // Full padding block
      expect(decryptAesEcb(ciphertext, testKey)).toEqual(plaintext);
    });
  });

  describe('generateAesKey', () => {
    it('generates a 16-byte key', () => {
      const { buffer } = generateAesKey();
      expect(buffer.length).toBe(16);
    });

    it('generates a 32-char hex string', () => {
      const { hex } = generateAesKey();
      expect(hex.length).toBe(32);
      expect(/^[0-9a-fA-F]{32}$/.test(hex)).toBe(true);
    });

    it('hex string matches buffer', () => {
      const { hex, buffer } = generateAesKey();
      expect(Buffer.from(hex, 'hex')).toEqual(buffer);
    });

    it('generates unique keys', () => {
      const key1 = generateAesKey();
      const key2 = generateAesKey();
      expect(key1.hex).not.toBe(key2.hex);
      expect(key1.buffer).not.toEqual(key2.buffer);
    });

    it('generated key works for encryption/decryption', () => {
      const { buffer } = generateAesKey();
      const plaintext = Buffer.from('Test with random key');
      const ciphertext = encryptAesEcb(plaintext, buffer);
      expect(decryptAesEcb(ciphertext, buffer)).toEqual(plaintext);
    });
  });
});
