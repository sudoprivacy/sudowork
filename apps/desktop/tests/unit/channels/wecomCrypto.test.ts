/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptWeComMedia, parseWeComAesKey } from '@/channels/plugins/wecom/WeComCrypto';

/**
 * Helper: encrypt plaintext with AES-256-CBC for testing decryption.
 */
function encryptAes256Cbc(plaintext: Buffer, key: Buffer, iv: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/**
 * Helper: encrypt plaintext with AES-128-ECB for testing decryption.
 */
function encryptAes128Ecb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

describe('WeComCrypto', () => {
  describe('parseWeComAesKey', () => {
    it('parses 32-byte key as AES-256-CBC', () => {
      // 32 bytes -> AES-256-CBC
      const rawKey = Buffer.alloc(32, 0xab);
      const base64Key = rawKey.toString('base64');
      const result = parseWeComAesKey(base64Key);
      expect(result).not.toBeNull();
      expect(result!.key.length).toBe(32);
      expect(result!.iv.length).toBe(16);
      expect(result!.algorithm).toBe('aes-256-cbc');
      // IV should be first 16 bytes of key
      expect(result!.iv).toEqual(rawKey.subarray(0, 16));
    });

    it('parses 16-byte key as AES-128-ECB', () => {
      // 16 bytes -> AES-128-ECB
      const rawKey = Buffer.from('0123456789abcdef'); // 16 bytes
      const base64Key = rawKey.toString('base64');
      const result = parseWeComAesKey(base64Key);
      expect(result).not.toBeNull();
      expect(result!.key.length).toBe(16);
      expect(result!.iv.length).toBe(0);
      expect(result!.algorithm).toBe('aes-128-ecb');
    });

    it('handles base64 keys with missing padding', () => {
      const rawKey = Buffer.alloc(32, 0xab);
      // Remove trailing '=' padding
      const base64Key = rawKey.toString('base64').replace(/=+$/, '');
      const result = parseWeComAesKey(base64Key);
      expect(result).not.toBeNull();
      expect(result!.key.length).toBe(32);
      expect(result!.algorithm).toBe('aes-256-cbc');
    });

    it('returns null for empty key', () => {
      expect(parseWeComAesKey('')).toBeNull();
    });

    it('returns null for invalid base64', () => {
      // A very short decoded key that is neither 16 nor 32 bytes
      const shortKey = Buffer.from('short').toString('base64');
      expect(parseWeComAesKey(shortKey)).toBeNull();
    });
  });

  describe('decryptWeComMedia', () => {
    describe('AES-256-CBC mode', () => {
      const key32 = Buffer.alloc(32, 0xab);
      const iv = key32.subarray(0, 16);

      it('decrypts AES-256-CBC encrypted data', () => {
        const plaintext = Buffer.from('Hello, WeCom media!');
        const ciphertext = encryptAes256Cbc(plaintext, key32, iv);

        // Ciphertext should differ from plaintext
        expect(ciphertext).not.toEqual(plaintext);

        const decrypted = decryptWeComMedia(ciphertext, key32, iv, 'aes-256-cbc');
        expect(decrypted).toEqual(plaintext);
      });

      it('handles binary data (simulating media files)', () => {
        const binaryData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08]);
        const ciphertext = encryptAes256Cbc(binaryData, key32, iv);
        const decrypted = decryptWeComMedia(ciphertext, key32, iv, 'aes-256-cbc');
        expect(decrypted).toEqual(binaryData);
      });

      it('handles empty plaintext (single padding block)', () => {
        const plaintext = Buffer.alloc(0);
        const ciphertext = encryptAes256Cbc(plaintext, key32, iv);
        const decrypted = decryptWeComMedia(ciphertext, key32, iv, 'aes-256-cbc');
        expect(decrypted).toEqual(plaintext);
      });

      it('does not recover the plaintext with a wrong key', () => {
        const plaintext = Buffer.from('test data');
        const ciphertext = encryptAes256Cbc(plaintext, key32, iv);
        const wrongKey = Buffer.alloc(32, 0xcd);
        const wrongIv = wrongKey.subarray(0, 16);
        // WeCom media uses non-standard padding, so decryption disables PKCS
        // auto-padding and never throws on a wrong key — it yields garbage that
        // is not the original plaintext (integrity is enforced downstream via the
        // media signature check, not by CBC padding validation).
        const decrypted = decryptWeComMedia(ciphertext, wrongKey, wrongIv, 'aes-256-cbc');
        expect(decrypted.equals(plaintext)).toBe(false);
      });
    });

    describe('AES-128-ECB mode', () => {
      const key16 = Buffer.from('0123456789abcdef'); // 16 bytes

      it('decrypts AES-128-ECB encrypted data', () => {
        const plaintext = Buffer.from('Hello, WeCom ECB mode!');
        const ciphertext = encryptAes128Ecb(plaintext, key16);

        expect(ciphertext).not.toEqual(plaintext);

        const decrypted = decryptWeComMedia(ciphertext, key16, Buffer.alloc(0), 'aes-128-ecb');
        expect(decrypted).toEqual(plaintext);
      });

      it('handles data that is exactly one block (16 bytes)', () => {
        const plaintext = Buffer.from('exactly16bytes!!');
        const ciphertext = encryptAes128Ecb(plaintext, key16);
        const decrypted = decryptWeComMedia(ciphertext, key16, Buffer.alloc(0), 'aes-128-ecb');
        expect(decrypted).toEqual(plaintext);
      });
    });
  });
});
