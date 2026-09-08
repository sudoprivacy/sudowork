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

import { NexusVfsClient } from '@nexus-ai-fs/vfs-client';

export interface StreamReadAtResult {
  data: Buffer;
  nextOffset: string;
  /** Non-blocking: true means "no data available now", NOT stream end. */
  eof: boolean;
  /**
   * A blocking read hit its timeout with no frame — a normal long-poll expiry,
   * so re-read from the same offset. `eof` is also true, so a reader that only
   * checks `eof` behaves as before; a real disconnect rejects instead.
   */
  timedOut: boolean;
}

/** The nexus VFS plane as the ACP tunnel uses it: Call + fd-stream read/write. */
export class NexusVfsGrpcClient {
  private readonly client: NexusVfsClient;
  private readonly token: string;

  constructor(address: string, token: string = '') {
    this.token = token;
    this.client = new NexusVfsClient(address);
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

  /** Append bytes to the fd stream at `streamPath` (StreamWriteNowait). */
  streamWrite(streamPath: string, data: Buffer): Promise<void> {
    return this.client.streamWrite(streamPath, data, this.token);
  }

  /**
   * Read bytes from `streamPath` at `offset` (non-blocking by default).
   * Resolves `{data, nextOffset, eof, timedOut}` — `eof=true` means "no data
   * now", NOT end. REJECTS on a stream error — that IS the real stream-closed /
   * agent-exited signal.
   */
  streamReadAt(streamPath: string, offset: string, opts: { blocking?: boolean; timeoutMs?: number } = {}): Promise<StreamReadAtResult> {
    return this.client.streamReadAt(streamPath, offset, this.token, opts);
  }

  close(): void {
    this.client.close();
  }
}
