/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { hasPluginCredentials, isBuiltinChannelPlatform } from '@/channels/types';

describe('Zentao type system', () => {
  it('hasPluginCredentials should return true for complete zentao credentials', () => {
    expect(hasPluginCredentials('zentao', { serverUrl: 'https://zentao.example.com', zentaoUsername: 'admin', zentaoPassword: 'pass123' })).toBe(true);
  });

  it('hasPluginCredentials should return false when missing password', () => {
    expect(hasPluginCredentials('zentao', { serverUrl: 'https://zentao.example.com', zentaoUsername: 'admin' })).toBe(false);
  });

  it('hasPluginCredentials should return false when missing username', () => {
    expect(hasPluginCredentials('zentao', { serverUrl: 'https://zentao.example.com', zentaoPassword: 'pass123' })).toBe(false);
  });

  it('hasPluginCredentials should return false when missing serverUrl', () => {
    expect(hasPluginCredentials('zentao', { zentaoUsername: 'admin', zentaoPassword: 'pass123' })).toBe(false);
  });

  it('hasPluginCredentials should return false for undefined credentials', () => {
    expect(hasPluginCredentials('zentao', undefined)).toBe(false);
  });

  it('isBuiltinChannelPlatform should return true for zentao', () => {
    expect(isBuiltinChannelPlatform('zentao')).toBe(true);
  });

  it('isBuiltinChannelPlatform should return false for unknown platform', () => {
    expect(isBuiltinChannelPlatform('unknown')).toBe(false);
  });
});
