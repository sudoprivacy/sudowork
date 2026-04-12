/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveOpenClawConnectionStatus, resolveOpenClawGatewayHealthStatus } from '@/process/utils/connectionStatus';

describe('resolveOpenClawConnectionStatus', () => {
  it('prefers live session status over stale disconnected cache', () => {
    expect(
      resolveOpenClawConnectionStatus({
        lastStatus: 'disconnected',
        isConnected: true,
        hasActiveSession: true,
      })
    ).toBe('session_active');
  });

  it('prefers live connected status over stale error cache', () => {
    expect(
      resolveOpenClawConnectionStatus({
        lastStatus: 'error',
        isConnected: true,
        hasActiveSession: false,
      })
    ).toBe('connected');
  });

  it('downgrades stale success cache when the transport is offline', () => {
    expect(
      resolveOpenClawConnectionStatus({
        lastStatus: 'session_active',
        isConnected: false,
        hasActiveSession: false,
      })
    ).toBe('disconnected');
  });

  it('keeps transitional offline states intact', () => {
    expect(
      resolveOpenClawConnectionStatus({
        lastStatus: 'connecting',
        isConnected: false,
        hasActiveSession: false,
      })
    ).toBe('connecting');
  });

  it('returns null when no status is known yet', () => {
    expect(
      resolveOpenClawConnectionStatus({
        lastStatus: null,
        isConnected: false,
        hasActiveSession: false,
      })
    ).toBeNull();
  });

  it('maps gateway health to connected status', () => {
    expect(resolveOpenClawGatewayHealthStatus(true)).toBe('connected');
    expect(resolveOpenClawGatewayHealthStatus(false)).toBe('disconnected');
  });
});
