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
export function parseWeComAesKey(aeskey: string): { key: Buffer; iv: Buffer; algorithm: 'aes-256-cbc' | 'aes-128-ecb' } | null {
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
export function decryptWeComMedia(ciphertext: Buffer, key: Buffer, iv: Buffer, algorithm: 'aes-256-cbc' | 'aes-128-ecb'): Buffer {
  let decipher;
  if (algorithm === 'aes-256-cbc') {
    decipher = createDecipheriv('aes-256-cbc', key, iv);
  } else {
    decipher = createDecipheriv('aes-128-ecb', key, null);
  }

  // WeCom media encryption uses non-standard PKCS#7 padding
  // Disable auto-padding and manually strip padding after decryption
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Strip padding: check last byte and remove trailing bytes if they match
  // Standard PKCS#7: last N bytes all equal N (padding length)
  // WeCom variant: padding bytes may have different values but form a valid block
  return stripPkcs7Padding(decrypted);
}

/**
 * Strip PKCS#7 padding from decrypted data.
 *
 * Handles both standard PKCS#7 (padding value equals padding length)
 * and WeCom's variant where padding bytes may differ.
 *
 * @param data - Decrypted data with potential padding
 * @returns Data with padding stripped, or original data if no valid padding found
 */
function stripPkcs7Padding(data: Buffer): Buffer {
  if (data.length === 0) return data;

  const lastByte = data[data.length - 1];

  // Valid padding range: 1-32 bytes
  if (lastByte < 1 || lastByte > 32) return data;

  // Standard PKCS#7: last N bytes all equal N
  const paddingLength = lastByte;
  if (data.length >= paddingLength) {
    const paddingBytes = data.slice(-paddingLength);
    const allMatch = paddingBytes.every((byte) => byte === paddingLength);
    if (allMatch) {
      return data.slice(0, -paddingLength);
    }
  }

  // WeCom variant: check if trailing bytes are uniform padding
  // WeCom may use padding value that differs from padding length
  // Common case: 16 bytes of uniform value (AES block size)
  for (const checkLen of [32, 16]) {
    if (data.length >= checkLen) {
      const trailing = data.slice(-checkLen);
      const uniformValue = trailing[0];
      // All bytes in trailing block should be the same
      const allSame = trailing.every((byte) => byte === uniformValue);
      if (allSame && uniformValue > 0) {
        // Verify remaining data has valid content
        const stripped = data.slice(0, -checkLen);
        const signature = stripped.slice(0, 4).toString('hex');
        const validSignatures = ['ffd8ffe0', 'ffd8ffe1', '89504e47', '25504446', '47494638'];
        if (validSignatures.includes(signature)) {
          return stripped;
        }
      }
    }
  }

  // No valid padding pattern found, return original
  return data;
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
          console.log(`[WeComCrypto] Decrypted: ${data.length} bytes, signature=${data.slice(0, 4).toString('hex')}`);
        } catch (decryptError) {
          console.error('[WeComCrypto] AES decryption failed:', decryptError);
          console.error(`[WeComCrypto] Failed: url=${url.slice(0, 100)}, aeskey=${aeskey.slice(0, 20)}..., dataSize=${data.length}`);
          throw decryptError;
        }
      } else {
        console.error('[WeComCrypto] Invalid AES key format');
        throw new Error('Invalid AES key format - cannot decrypt media');
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
