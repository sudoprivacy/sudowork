/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The nexus VFS gRPC plane as the ACP tunnel uses it: the generic `Call` RPC
 * carries managed_agent methods (start_session / cancel / get_session), and
 * StreamReadAt / StreamWriteNowait move raw bytes on the agent's fd streams.
 *
 * The wire work belongs to `@nexus-ai-fs/vfs-client`, which nexus-vfs publishes
 * from the same tree as `proto/nexus/grpc/vfs/vfs.proto`. This file is only the
 * shape the tunnel wants on top of it: JSON params in, `{result: …}` unwrapped
 * out, and stream reads that return a plain object.
 */

import { NexusVfsClient, NexusSessionTransport, type NexusSessionEndpoint, type NexusSessionTransportOptions } from '@nexus-ai-fs/vfs-client';

/** Nexus session control calls and the shared mailbox transport. */
export class NexusVfsGrpcClient {
  private readonly client: NexusVfsClient;
  private readonly token: string;

  constructor(address: string, token: string = '', rpcTimeoutMs?: number) {
    this.token = token;
    this.client = new NexusVfsClient(address, { connectTimeoutMs: rpcTimeoutMs });
  }

  /**
   * One generic dispatch Call: `method` + JSON params → parsed JSON result.
   * The rpc_codec wraps success as `{"result": <value>}`; this unwraps it.
   * Rejects when the daemon flags the response as an error.
   */
  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const raw = await this.client.call(method, JSON.stringify(params), this.token);
    const body = raw.length ? JSON.parse(raw) : null;
    return body && typeof body === 'object' && 'result' in body ? (body as { result: T }).result : (body as T);
  }

  openSession(endpoint: NexusSessionEndpoint, events: Pick<NexusSessionTransportOptions, 'onMessage' | 'onClose'>): NexusSessionTransport {
    return new NexusSessionTransport({ client: this.client, endpoint, authToken: this.token, ...events });
  }

  close(): void {
    this.client.close();
  }
}
