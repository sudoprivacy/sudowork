/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * grpc-js client for the nexus VFS gRPC plane — the transport under the ACP
 * tunnel. Mirrors hydra's vfsClient: the generic `Call` RPC carries
 * managed_agent methods (start_session / cancel / get_session), and
 * StreamReadAt / StreamWriteNowait move raw bytes on the agent's fd streams.
 *
 * The wire stub is a minimal self-contained proto3 subset, inlined and loaded
 * from a temp file so it travels with the bundle — no runtime .proto path
 * resolution across Electron dev / packaged / asar. Field numbers match the
 * canonical nexus-vfs `proto/nexus/grpc/vfs/vfs.proto` exactly.
 */

import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import * as protoLoader from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';

const VFS_PROTO = `
syntax = "proto3";
package nexus.grpc.vfs;

service NexusVFSService {
  rpc Call(CallRequest) returns (CallResponse);
  rpc StreamReadAt(StreamReadAtRequest) returns (StreamReadAtResponse);
  rpc StreamWriteNowait(StreamWriteRequest) returns (StreamWriteResponse);
}

message CallRequest { string method = 1; bytes payload = 2; string auth_token = 3; }
message CallResponse { bytes payload = 1; bool is_error = 2; }

message StreamReadAtRequest { string path = 1; uint64 offset = 2; bool blocking = 3; uint64 timeout_ms = 4; string auth_token = 5; }
message StreamReadAtResponse { bytes data = 1; uint64 next_offset = 2; bool eof = 3; bool is_error = 4; bytes error_payload = 5; }

message StreamWriteRequest { string path = 1; bytes data = 2; string auth_token = 3; }
message StreamWriteResponse { uint64 offset = 1; bool is_error = 2; bytes error_payload = 3; }
`;

interface CallResponseWire {
  payload?: Buffer;
  is_error?: boolean;
}
interface StreamReadAtWire {
  data?: Buffer;
  next_offset?: string;
  eof?: boolean;
  is_error?: boolean;
  error_payload?: Buffer;
}
interface StreamWriteWire {
  is_error?: boolean;
  error_payload?: Buffer;
}

/** The dynamically proto-loaded client, narrowed to the three RPCs we call. */
interface VfsGrpcClient {
  Call(req: object, cb: (err: grpc.ServiceError | null, res: CallResponseWire) => void): void;
  StreamReadAt(req: object, cb: (err: grpc.ServiceError | null, res: StreamReadAtWire) => void): void;
  StreamWriteNowait(req: object, cb: (err: grpc.ServiceError | null, res: StreamWriteWire) => void): void;
  close(): void;
}

let cachedService: grpc.ServiceClientConstructor | null = null;

function loadService(): grpc.ServiceClientConstructor {
  if (cachedService) return cachedService;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sudowork-vfs-'));
  const protoPath = path.join(dir, 'vfs.proto');
  writeFileSync(protoPath, VFS_PROTO, 'utf-8');
  const def = protoLoader.loadSync(protoPath, {
    keepCase: true, // snake_case wire fields: auth_token, is_error, next_offset, …
    longs: String, // uint64 offsets as strings
    defaults: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as unknown as {
    nexus: { grpc: { vfs: { NexusVFSService: grpc.ServiceClientConstructor } } };
  };
  cachedService = pkg.nexus.grpc.vfs.NexusVFSService;
  return cachedService;
}

export interface StreamReadAtResult {
  data: Buffer;
  nextOffset: string;
  /** Non-blocking: true means "no data available now", NOT stream end. */
  eof: boolean;
}

function errText(payload?: Buffer): string {
  return payload && payload.length ? Buffer.from(payload).toString() : '(no payload)';
}

/** Thin grpc-js client over the nexus VFS plane: Call + fd-stream read/write. */
export class NexusVfsGrpcClient {
  private readonly client: VfsGrpcClient;
  private readonly token: string;

  constructor(address: string, token: string = '') {
    this.token = token;
    const Service = loadService();
    this.client = new Service(address, grpc.credentials.createInsecure()) as unknown as VfsGrpcClient;
  }

  /**
   * One generic dispatch Call: `method` + JSON params → parsed JSON result.
   * The rpc_codec wraps success as `{"result": <value>}`; this unwraps it.
   * Rejects when the daemon flags `is_error`.
   */
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.client.Call({ method, payload: Buffer.from(JSON.stringify(params)), auth_token: this.token }, (err, res) => {
        if (err) return reject(err);
        const body = res.payload && res.payload.length ? JSON.parse(Buffer.from(res.payload).toString()) : null;
        if (res.is_error) return reject(new Error(`${method}: ${JSON.stringify(body)}`));
        resolve(body && typeof body === 'object' && 'result' in body ? (body as { result: T }).result : (body as T));
      });
    });
  }

  /** Append bytes to the fd stream at `streamPath` (StreamWriteNowait). Rejects on is_error. */
  streamWrite(streamPath: string, data: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.client.StreamWriteNowait({ path: streamPath, data, auth_token: this.token }, (err, res) => {
        if (err) return reject(err);
        if (res.is_error) return reject(new Error(`StreamWriteNowait: ${errText(res.error_payload)}`));
        resolve();
      });
    });
  }

  /**
   * Read bytes from `streamPath` at `offset` (non-blocking by default).
   * Resolves `{data, nextOffset, eof}` — `eof=true` means "no data now", NOT end.
   * REJECTS on `is_error` — that IS the real stream-closed / agent-exited signal.
   */
  streamReadAt(streamPath: string, offset: string, opts: { blocking?: boolean; timeoutMs?: number } = {}): Promise<StreamReadAtResult> {
    return new Promise<StreamReadAtResult>((resolve, reject) => {
      this.client.StreamReadAt({ path: streamPath, offset, blocking: opts.blocking ?? false, timeout_ms: opts.timeoutMs ?? 0, auth_token: this.token }, (err, res) => {
        if (err) return reject(err);
        if (res.is_error) return reject(new Error(`StreamReadAt: ${errText(res.error_payload)}`));
        resolve({
          data: res.data && res.data.length ? Buffer.from(res.data) : Buffer.alloc(0),
          nextOffset: res.next_offset ?? offset,
          eof: res.eof ?? false,
        });
      });
    });
  }

  close(): void {
    this.client.close();
  }
}
