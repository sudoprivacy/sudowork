/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { NexusVfsClient } from '@nexus-ai-fs/vfs-client';
import { NexusVfsGrpcClient } from '../../src/common/nexus/nexusVfsGrpcClient';

vi.mock('@nexus-ai-fs/vfs-client', { spy: true });

describe('NexusVfsGrpcClient', () => {
  it.each([undefined, 45_000, 75_000])('passes the RPC timeout %s to the SDK', (rpcTimeoutMs) => {
    const client = new NexusVfsGrpcClient('127.0.0.1:1', '', rpcTimeoutMs);
    try {
      expect(NexusVfsClient).toHaveBeenLastCalledWith('127.0.0.1:1', { connectTimeoutMs: rpcTimeoutMs });
    } finally {
      client.close();
    }
  });

  it('loads the inlined vfs proto and constructs the NexusVFSService client', () => {
    // Constructing does not open a connection — it exercises loadService():
    // writing the inlined proto, proto-loader loadSync, and resolving
    // pkg.nexus.grpc.vfs.NexusVFSService. A typo in the proto string (which tsc
    // cannot catch) would throw here.
    const client = new NexusVfsGrpcClient('127.0.0.1:1', '');
    expect(client).toBeInstanceOf(NexusVfsGrpcClient);
    expect(typeof client.call).toBe('function');
    expect(typeof client.streamReadAt).toBe('function');
    expect(typeof client.streamWrite).toBe('function');
    client.close();
  });

  it('caches the loaded service across instances', () => {
    // Second construction reuses the cached service constructor (no re-parse).
    const a = new NexusVfsGrpcClient('127.0.0.1:1');
    const b = new NexusVfsGrpcClient('127.0.0.1:2');
    expect(a).toBeInstanceOf(NexusVfsGrpcClient);
    expect(b).toBeInstanceOf(NexusVfsGrpcClient);
    a.close();
    b.close();
  });
});
