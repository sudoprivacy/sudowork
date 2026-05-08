/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  computeSignature,
  decodeAesKey,
  decryptCallback,
  encryptCallback,
  verifySignature,
} from '@/channels/plugins/wecom-app/WeComAppCrypto';

// 43-char EncodingAESKey (32 bytes when base64-decoded with trailing '=')
const TEST_AES_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const RECEIVE_ID = 'wwcorpidtest123';
const TOKEN = 'unit-test-token';

describe('WeComAppCrypto', () => {
  describe('decodeAesKey', () => {
    it('decodes a 43-char EncodingAESKey to 32 bytes', () => {
      const key = decodeAesKey(TEST_AES_KEY);
      expect(key.length).toBe(32);
    });

    it('throws on empty key', () => {
      expect(() => decodeAesKey('')).toThrow();
    });

    it('throws on wrong-length key', () => {
      expect(() => decodeAesKey('tooshort')).toThrow();
    });
  });

  describe('computeSignature / verifySignature', () => {
    it('computes a deterministic SHA1 of sorted token+timestamp+nonce+encrypt', () => {
      const sig = computeSignature(TOKEN, '1700000000', 'nonce1', 'encrypted-payload');
      // should be a 40-char lowercase hex
      expect(sig).toMatch(/^[0-9a-f]{40}$/);
      // stable across invocations
      expect(computeSignature(TOKEN, '1700000000', 'nonce1', 'encrypted-payload')).toBe(sig);
    });

    it('is independent of argument order (values are sorted)', () => {
      const a = computeSignature('aaa', 'bbb', 'ccc', 'ddd');
      const b = computeSignature('ddd', 'ccc', 'bbb', 'aaa');
      expect(a).toBe(b);
    });

    it('verifySignature returns true for correct signature', () => {
      const sig = computeSignature(TOKEN, '1700000000', 'abc', 'encpay');
      expect(verifySignature(sig, TOKEN, '1700000000', 'abc', 'encpay')).toBe(true);
    });

    it('verifySignature returns false for wrong signature', () => {
      expect(verifySignature('deadbeef', TOKEN, '1700000000', 'abc', 'encpay')).toBe(false);
    });

    it('verifySignature returns false for empty signature', () => {
      expect(verifySignature('', TOKEN, '1700000000', 'abc', 'encpay')).toBe(false);
    });
  });

  describe('encryptCallback / decryptCallback roundtrip', () => {
    it('roundtrips a short XML message', () => {
      const xml = '<xml><ToUserName><![CDATA[wxapp]]></ToUserName><MsgType>text</MsgType></xml>';
      const encrypted = encryptCallback(xml, TEST_AES_KEY, RECEIVE_ID);
      const { message, receiveId } = decryptCallback(encrypted, TEST_AES_KEY, RECEIVE_ID);
      expect(message).toBe(xml);
      expect(receiveId).toBe(RECEIVE_ID);
    });

    it('roundtrips a long message (multiple AES blocks)', () => {
      const xml = `<xml>${'A'.repeat(500)}</xml>`;
      const encrypted = encryptCallback(xml, TEST_AES_KEY, RECEIVE_ID);
      const { message, receiveId } = decryptCallback(encrypted, TEST_AES_KEY, RECEIVE_ID);
      expect(message).toBe(xml);
      expect(receiveId).toBe(RECEIVE_ID);
    });

    it('roundtrips with UTF-8 content', () => {
      const xml = '<xml><Content>你好，WeCom 自建应用！</Content></xml>';
      const encrypted = encryptCallback(xml, TEST_AES_KEY, RECEIVE_ID);
      const { message } = decryptCallback(encrypted, TEST_AES_KEY, RECEIVE_ID);
      expect(message).toBe(xml);
    });

    it('produces different ciphertext across calls (random prefix)', () => {
      const xml = '<xml>same payload</xml>';
      const a = encryptCallback(xml, TEST_AES_KEY, RECEIVE_ID);
      const b = encryptCallback(xml, TEST_AES_KEY, RECEIVE_ID);
      expect(a).not.toBe(b);
    });

    it('decryptCallback throws on receiveId mismatch', () => {
      const xml = '<xml>hello</xml>';
      const encrypted = encryptCallback(xml, TEST_AES_KEY, RECEIVE_ID);
      expect(() => decryptCallback(encrypted, TEST_AES_KEY, 'wrong-corp')).toThrow(/receiveId mismatch/);
    });

    it('decryptCallback throws on wrong EncodingAESKey', () => {
      const xml = '<xml>hello</xml>';
      const encrypted = encryptCallback(xml, TEST_AES_KEY, RECEIVE_ID);
      // Different 43-char key
      const wrongKey = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
      expect(() => decryptCallback(encrypted, wrongKey, RECEIVE_ID)).toThrow();
    });

    it('decryptCallback throws on truncated/invalid ciphertext', () => {
      expect(() => decryptCallback('not-valid-base64-at-all!!!', TEST_AES_KEY, RECEIVE_ID)).toThrow();
    });

    it('omitting expectedReceiveId still decrypts and returns the embedded corpid', () => {
      const xml = '<xml>ok</xml>';
      const encrypted = encryptCallback(xml, TEST_AES_KEY, RECEIVE_ID);
      const { message, receiveId } = decryptCallback(encrypted, TEST_AES_KEY);
      expect(message).toBe(xml);
      expect(receiveId).toBe(RECEIVE_ID);
    });
  });
});
