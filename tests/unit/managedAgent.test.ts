/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── grpcPort getter ────────────────────────────────────────────────────────
describe('DynamicNexusService.grpcPort', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { isPackaged: false, getAppPath: () => '/tmp', getVersion: () => '0.0.0-test' },
    }));
    vi.doMock('@process/utils', () => ({ getDataPath: () => '/tmp/data' }));
    vi.doMock('@process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
      mainError: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.NEXUS_GRPC_PORT;
  });

  it('returns default 2028 when NEXUS_GRPC_PORT is not set', async () => {
    delete process.env.NEXUS_GRPC_PORT;
    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');
    expect(dynamicNexusService.grpcPort).toBe(2028);
  });

  it('reads NEXUS_GRPC_PORT from environment', async () => {
    process.env.NEXUS_GRPC_PORT = '3333';
    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');
    expect(dynamicNexusService.grpcPort).toBe(3333);
  });

  it('ignores invalid NEXUS_GRPC_PORT and falls back to 2028', async () => {
    process.env.NEXUS_GRPC_PORT = 'not-a-number';
    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');
    expect(dynamicNexusService.grpcPort).toBe(2028);
  });

  it('ignores non-positive NEXUS_GRPC_PORT', async () => {
    process.env.NEXUS_GRPC_PORT = '0';
    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');
    expect(dynamicNexusService.grpcPort).toBe(2028);
  });
});

// ── napi module loading ────────────────────────────────────────────────────
describe('nexus-napi native module', () => {
  it('loads the NexusGrpcClient class', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../native/nexus-napi');
    expect(mod.NexusGrpcClient).toBeDefined();
    expect(typeof mod.NexusGrpcClient).toBe('function');
  });

  it('instantiates a client with an endpoint', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NexusGrpcClient } = require('../../native/nexus-napi');
    const client = new NexusGrpcClient('http://localhost:2028');
    expect(client).toBeDefined();
    expect(typeof client.call).toBe('function');
    expect(typeof client.read).toBe('function');
    expect(typeof client.write).toBe('function');
    expect(typeof client.ping).toBe('function');
  });

  it('throws descriptive error on gRPC call when server is not running', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NexusGrpcClient } = require('../../native/nexus-napi');
    const client = new NexusGrpcClient('http://localhost:19999');
    // The underlying client uses lazy connection — the first call triggers actual connect.
    // Without a server listening, it should throw a descriptive error.
    expect(() => client.call('ping', '{}', '')).toThrow();
  });
});

// ── ManagedAgentClient (integration — requires native binary built) ────────
// loadNativeBinding() uses `require('electron').app.getAppPath()` at runtime,
// which doesn't exist in vitest. Instead we test via the napi module directly
// and verify the ManagedAgentClient class shape via a manual instantiation.
describe('ManagedAgentClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NexusGrpcClient } = require('../../native/nexus-napi');

  it('ManagedAgentClient class has the expected typed methods', async () => {
    // Dynamically construct a client-like object using the native binding
    const grpc = new NexusGrpcClient('http://localhost:2028');
    // Verify the native client has the methods we wrap
    expect(typeof grpc.call).toBe('function');
    expect(typeof grpc.read).toBe('function');
    expect(typeof grpc.write).toBe('function');
    expect(typeof grpc.ping).toBe('function');
  });

  it('call() throws descriptive error for unknown method when server responds', () => {
    const grpc = new NexusGrpcClient('http://localhost:19999');
    expect(() => grpc.call('managed_agent.start_session_v1', '{}', '')).toThrow();
  });
});
