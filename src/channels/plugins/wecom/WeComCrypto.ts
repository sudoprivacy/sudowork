/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createDecipheriv } from 'node:crypto';

/**
 * Parse a WeCom AES key from its base64 representation.
 *
 * In long-connection mode, WeCom returns an `aeskey` field for encrypted media
 * (image, file, video). The key is base64-encoded and may decode to different
 * lengths depending on the encryption scheme:
 *
 * 1. 32 bytes -> AES-256-CBC (key = 32 bytes, IV = first 16 bytes of key)
 * 2. 16 bytes -> AES-128-ECB (same as standard WeChat)
 * 3. 32 ASCII hex chars -> 16 bytes (indirect encoding, same as WeChat variant)
 *
 * Reference: https://developer.work.weixin.qq.com/document/path/101463
 *
 * @param aeskey - The base64-encoded AES key from WeCom callback
 * @returns Parsed key info with algorithm details, or null if invalid
 */
export function parseWeComAesKey(
  aeskey: string,
): { key: Buffer; iv: Buffer; algorithm: 'aes-256-cbc' | 'aes-128-ecb' } | null {
  if (!aeskey) return null;

  try {
    // WeCom aeskey may need base64 padding
    let paddedKey = aeskey;
    while (paddedKey.length % 4 !== 0) {
      paddedKey += '=';
    }

    const decoded = Buffer.from(paddedKey, 'base64');

    if (decoded.length === 32) {
      // AES-256-CBC: key = 32 bytes, IV = first 16 bytes
      return {
        key: decoded,
        iv: decoded.subarray(0, 16),
        algorithm: 'aes-256-cbc',
      };
    }

    if (decoded.length === 16) {
      // AES-128-ECB: key = 16 bytes, no IV needed
      return {
        key: decoded,
        iv: Buffer.alloc(0),
        algorithm: 'aes-128-ecb',
      };
    }

    // Indirect: 32 hex ASCII chars -> 16 raw bytes (same as WeChat variant)
    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
      const rawKey = Buffer.from(decoded.toString('ascii'), 'hex');
      return {
        key: rawKey,
        iv: Buffer.alloc(0),
        algorithm: 'aes-128-ecb',
      };
    }

    console.warn(`[WeComCrypto] Unexpected key length after base64 decode: ${decoded.length}`);
    return null;
  } catch {
    return null;
  }
}

/**
 * Decrypt WeCom media data using the parsed key info.
 *
 * Supports:
 * - AES-256-CBC with PKCS7 padding (32-byte key)
 * - AES-128-ECB with PKCS7 padding (16-byte key, same as WeChat)
 *
 * @param ciphertext - The encrypted data buffer
 * @param key - AES key buffer
 * @param iv - Initialization vector (empty for ECB mode)
 * @param algorithm - The encryption algorithm
 * @returns The decrypted plaintext buffer
 */
export function decryptWeComMedia(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  algorithm: 'aes-256-cbc' | 'aes-128-ecb',
): Buffer {
  if (algorithm === 'aes-256-cbc') {
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  // AES-128-ECB (null IV for ECB mode)
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Download and decrypt a WeCom media file.
 *
 * Downloads the encrypted resource from the given URL, then decrypts it
 * using the provided aeskey. If decryption fails, returns the raw data
 * as a fallback to avoid blocking the message flow.
 *
 * @param url - The media download URL from WeCom callback
 * @param aeskey - The base64-encoded AES key from WeCom callback
 * @param timeoutMs - Download timeout in milliseconds (default: 30s)
 * @returns The decrypted (or raw fallback) file data
 */
export async function downloadAndDecryptMedia(url: string, aeskey: string, timeoutMs = 30_000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Media download failed: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    let data: Buffer = Buffer.from(arrayBuffer);

    // Decrypt if aeskey is provided
    if (aeskey) {
      const parsed = parseWeComAesKey(aeskey);
      if (parsed) {
        try {
          data = decryptWeComMedia(data, parsed.key, parsed.iv, parsed.algorithm);
        } catch (decryptError) {
          console.warn('[WeComCrypto] AES decryption failed, returning raw data:', decryptError);
          // Return raw data as fallback - some media may not actually be encrypted
        }
      } else {
        console.warn('[WeComCrypto] Invalid AES key format, returning raw data');
      }
    }

    return data;
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Media download timed out');
    }
    throw error;
  }
}
