/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Parse a WeChat AES key from its base64 representation.
 *
 * WeChat uses two encoding variants in practice:
 * 1. Direct: base64 decodes to 16 raw bytes (the AES-128 key).
 * 2. Indirect: base64 decodes to 32 ASCII hex characters, which represent 16 bytes.
 *
 * @returns A 16-byte Buffer suitable for AES-128 operations.
 */
export function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64');

  if (decoded.length === 16) {
    // Direct: base64 -> 16 raw bytes
    return decoded;
  }

  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    // Indirect: base64 -> 32-char hex string -> 16 raw bytes
    return Buffer.from(decoded.toString('ascii'), 'hex');
  }

  throw new Error(`Invalid WeChat AES key: decoded length=${decoded.length}, expected 16 bytes or 32-char hex string`);
}

/**
 * Normalize an AES key from various WeChat sources.
 *
 * - ImageItem.aeskey is a hex string (32 hex chars = 16 bytes).
 * - media.aes_key is base64-encoded.
 *
 * @param aesKey - The AES key from media.aes_key (base64) or ImageItem.aeskey (hex)
 * @param isHex - Whether the key is hex-encoded (ImageItem.aeskey)
 * @returns A 16-byte Buffer suitable for AES-128 operations, or null if key is invalid/empty.
 */
export function normalizeAesKey(aesKey: string, isHex = false): Buffer | null {
  if (!aesKey) return null;

  try {
    if (isHex) {
      // ImageItem.aeskey: hex string (32 hex chars -> 16 bytes)
      const buf = Buffer.from(aesKey, 'hex');
      if (buf.length !== 16) return null;
      return buf;
    }

    // media.aes_key: base64-encoded (handles both direct and indirect variants)
    return parseAesKey(aesKey);
  } catch {
    return null;
  }
}

/**
 * Decrypt data encrypted with AES-128-ECB.
 *
 * WeChat CDN media files are encrypted with AES-128-ECB + PKCS7 padding.
 * Node.js crypto's default auto-padding handles PKCS7 removal.
 *
 * @param ciphertext - The encrypted data buffer
 * @param key - 16-byte AES key
 * @returns The decrypted plaintext buffer
 */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypt data with AES-128-ECB.
 *
 * WeChat CDN media upload requires AES-128-ECB encryption with PKCS7 padding.
 * Node.js crypto's default auto-padding handles PKCS7 padding.
 *
 * @param plaintext - The raw file content
 * @param key - 16-byte AES key
 * @returns The encrypted ciphertext buffer
 */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/**
 * Generate a random 16-byte AES key for media encryption.
 *
 * @returns Object with hex string (32 chars) and raw Buffer (16 bytes)
 */
export function generateAesKey(): { hex: string; buffer: Buffer } {
  const buffer = randomBytes(16);
  return { hex: buffer.toString('hex'), buffer };
}
