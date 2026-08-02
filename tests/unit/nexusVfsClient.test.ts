/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { NexusVfsClient } from '../../src/agent/acp/nexusVfsClient';

describe('NexusVfsClient', () => {
  it('loads the inlined vfs proto and constructs the NexusVFSService client', () => {
    // Constructing does not open a connection — it exercises loadService():
    // writing the inlined proto, proto-loader loadSync, and resolving
    // pkg.nexus.grpc.vfs.NexusVFSService. A typo in the proto string (which tsc
    // cannot catch) would throw here.
    const client = new NexusVfsClient('127.0.0.1:1', '');
    expect(client).toBeInstanceOf(NexusVfsClient);
    expect(typeof client.call).toBe('function');
    expect(typeof client.streamReadAt).toBe('function');
    expect(typeof client.streamWrite).toBe('function');
    client.close();
  });

  it('caches the loaded service across instances', () => {
    // Second construction reuses the cached service constructor (no re-parse).
    const a = new NexusVfsClient('127.0.0.1:1');
    const b = new NexusVfsClient('127.0.0.1:2');
    expect(a).toBeInstanceOf(NexusVfsClient);
    expect(b).toBeInstanceOf(NexusVfsClient);
    a.close();
    b.close();
  });
});
