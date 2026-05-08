/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * WeCom 自建应用 callback envelope crypto.
 *
 * Reference: https://developer.work.weixin.qq.com/document/path/90968
 *
 * Signature:   sha1 = SHA1( sort([token, timestamp, nonce, encrypt]).join('') )
 *
 * Envelope (after base64-decoding the `encrypt` field):
 *   [ 16 random bytes (pad/iv) ] [ 4 bytes BE msg length ] [ msg bytes ] [ receiveid bytes ] [ pkcs7 padding ]
 *
 * The `receiveid` for a self-built corp app is the corpId.
 * AES-256-CBC with key = base64decode(EncodingAESKey + '='), IV = first 16 bytes of key.
 */

const AES_BLOCK_SIZE = 32;

export interface WeComAppCryptoConfig {
  token: string;
  encodingAesKey: string;
  receiveId: string; // corpId for 自建应用
}

/**
 * Decode the EncodingAESKey (43 chars of url-safe base64) to a 32-byte AES key.
 */
export function decodeAesKey(encodingAesKey: string): Buffer {
  if (!encodingAesKey) throw new Error('EncodingAESKey is empty');
  // EncodingAESKey is 43 chars; add '=' padding to make it valid base64
  const padded = encodingAesKey + '=';
  const key = Buffer.from(padded, 'base64');
  if (key.length !== 32) {
    throw new Error(`Invalid EncodingAESKey: decoded length ${key.length}, expected 32`);
  }
  return key;
}

/**
 * Compute the callback signature.
 * Arguments are lexically sorted, joined, then SHA1 hashed.
 */
export function computeSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const parts = [token, timestamp, nonce, encrypt].sort();
  const joined = parts.join('');
  return createHash('sha1').update(joined).digest('hex');
}

/**
 * Verify the signature from a callback request.
 */
export function verifySignature(
  signature: string,
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): boolean {
  if (!signature) return false;
  const expected = computeSignature(token, timestamp, nonce, encrypt);
  return expected === signature;
}

/**
 * Decrypt a callback `encrypt` payload and return the inner message plus the receiveid trailer.
 *
 * Throws on malformed input, padding error, or receiveid mismatch.
 */
export function decryptCallback(encrypt: string, encodingAesKey: string, expectedReceiveId?: string): { message: string; receiveId: string } {
  const key = decodeAesKey(encodingAesKey);
  const iv = key.subarray(0, 16);
  const ciphertext = Buffer.from(encrypt, 'base64');
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error(`Invalid ciphertext length: ${ciphertext.length}`);
  }

  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const unpadded = stripPkcs7(decrypted);
  if (unpadded.length < 20) {
    throw new Error('Decrypted payload too short');
  }

  // 16 random bytes prefix | 4 BE msg length | msg | receiveid
  const msgLen = unpadded.readUInt32BE(16);
  if (msgLen <= 0 || 20 + msgLen > unpadded.length) {
    throw new Error(`Invalid msg length: ${msgLen} (total ${unpadded.length})`);
  }
  const message = unpadded.subarray(20, 20 + msgLen).toString('utf8');
  const receiveId = unpadded.subarray(20 + msgLen).toString('utf8');

  if (expectedReceiveId && expectedReceiveId !== receiveId) {
    throw new Error(`receiveId mismatch: got "${receiveId}", expected "${expectedReceiveId}"`);
  }

  return { message, receiveId };
}

/**
 * Encrypt a message to the WeCom callback envelope format. Primarily used for
 * the URL-verification handshake response and for unit tests (round-trip).
 */
export function encryptCallback(message: string, encodingAesKey: string, receiveId: string, randomPrefix?: Buffer): string {
  const key = decodeAesKey(encodingAesKey);
  const iv = key.subarray(0, 16);
  const prefix = randomPrefix ?? randomBytes(16);
  if (prefix.length !== 16) throw new Error('randomPrefix must be 16 bytes');

  const msg = Buffer.from(message, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msg.length, 0);
  const receiveIdBuf = Buffer.from(receiveId, 'utf8');

  const body = Buffer.concat([prefix, lenBuf, msg, receiveIdBuf]);
  const padded = addPkcs7(body);

  const cipher = createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString('base64');
}

function addPkcs7(data: Buffer): Buffer {
  const remainder = data.length % AES_BLOCK_SIZE;
  const padLen = AES_BLOCK_SIZE - remainder;
  const pad = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, pad]);
}

function stripPkcs7(data: Buffer): Buffer {
  if (data.length === 0) return data;
  const pad = data[data.length - 1];
  if (pad < 1 || pad > AES_BLOCK_SIZE) {
    throw new Error(`Invalid PKCS7 padding byte: ${pad}`);
  }
  return data.subarray(0, data.length - pad);
}
