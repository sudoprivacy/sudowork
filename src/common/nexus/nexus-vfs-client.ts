/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Nexus RPC Client
 *
 * File I/O client backed by nexusd-cluster gRPC (port 12022).
 * Uses the nexus-napi native addon for typed Read/Write RPCs and
 * the generic Call RPC for stat/readdir/unlink/mkdir.
 *
 * Migrated from HTTP JSON-RPC (:12012) to gRPC (:12022) — all callers
 * (safety hooks, etc.) keep the same public API.
 */

export interface NexusRpcOptions {
  /** gRPC endpoint (default: http://localhost:12022) */
  endpoint?: string;
  /** Auth token for gRPC calls */
  authToken?: string;
  /** @deprecated Use endpoint instead */
  serverUrl?: string;
  /** @deprecated Use authToken instead */
  apiKey?: string;
}

// Lazy-load the native addon (same pattern as ACP transport).
function loadNativeBinding(): typeof import('../../../native/nexus-napi') {
  try {
    const { app } = require('electron');
    const path = require('path');
    const appRoot = app.isPackaged ? app.getAppPath().replace('app.asar', 'app.asar.unpacked') : app.getAppPath();
    return require(path.join(appRoot, 'native', 'nexus-napi'));
  } catch {
    throw new Error('nexus-napi native module not available. Run `bun run build:native` first.');
  }
}

type GrpcClient = InstanceType<ReturnType<typeof loadNativeBinding>['NexusGrpcClient']>;

export class Nexus {
  private readonly client: GrpcClient;
  private readonly authToken: string;

  constructor(options?: NexusRpcOptions) {
    const endpoint = options?.endpoint ?? options?.serverUrl ?? 'http://localhost:12022';
    this.authToken = options?.authToken ?? options?.apiKey ?? '';
    const { NexusGrpcClient } = loadNativeBinding();
    this.client = new NexusGrpcClient(endpoint);
  }

  /**
   * Binary gRPC Call RPC — dispatches raw protobuf bytes to a service method.
   * Used by NexusSecretClient for vault plugin dispatch.
   */
  public callBinary(method: string, payload: Buffer): Buffer {
    try {
      return this.client.callBinary(method, payload, this.authToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`RPC error: ${method}: ${msg}`);
    }
  }

  /**
   * Generic gRPC Call RPC — dispatches to kernel method by name.
   */
  public async callRPC(method: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      const raw = this.client.call(method, JSON.stringify(params), this.authToken);
      return JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`RPC error: ${method}: ${msg}`);
    }
  }

  public async write(path: string, content: string | Buffer, _if_match?: string, _if_none_match?: boolean, _force?: boolean): Promise<Record<string, unknown>> {
    try {
      const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
      this.client.write(path, buf, this.authToken);
      return { path, size: buf.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`write failed: ${msg}`, path);
    }
  }

  public async read(path: string, returnMetadata?: boolean): Promise<Buffer | Record<string, unknown>> {
    try {
      const buf = this.client.read(path, this.authToken);
      if (returnMetadata) {
        // Fetch stat separately for metadata
        const stat = (await this.callRPC('sys_stat', { path })) as Record<string, unknown> | null;
        return { content: buf, ...(stat ?? {}) };
      }
      return buf;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`read failed: ${msg}`, path);
    }
  }

  public async exists(path: string): Promise<boolean> {
    try {
      const raw = this.client.call('access', JSON.stringify({ path }), this.authToken);
      const result = JSON.parse(raw);
      return !!result;
    } catch {
      return false;
    }
  }

  /**
   * Create a directory at the specified path.
   * @param path Directory path to create
   * @param parents If true, create parent directories as needed (like mkdir -p)
   */
  public async mkdir(path: string, parents?: boolean): Promise<void> {
    await this.callRPC('mkdir', { path, parents: parents ?? true });
  }

  /**
   * List contents of a directory.
   * @param path Directory path to list
   * @returns Array of directory items with name, path, isDirectory, etc.
   */
  public async list(path: string): Promise<NexusListItem[]> {
    try {
      const raw = this.client.call('sys_readdir', JSON.stringify({ path }), this.authToken);
      const result = JSON.parse(raw);
      // sys_readdir returns array of [path, entry_type] tuples or objects
      if (Array.isArray(result)) {
        return result.map((item: unknown): NexusListItem => {
          if (Array.isArray(item) && item.length >= 2) {
            const itemPath = String(item[0]);
            return {
              path: itemPath,
              name: itemPath.split('/').pop() || itemPath,
              entry_type: Number(item[1]),
              isDirectory: Number(item[1]) === 1,
            };
          }
          if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            const itemPath = typeof obj.path === 'string' ? obj.path : '';
            return {
              ...obj,
              path: itemPath,
              name: typeof obj.name === 'string' ? obj.name : itemPath.split('/').pop() || itemPath,
            } as NexusListItem;
          }
          return { path: '', name: '' };
        });
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Delete a file or directory.
   * @param path Path to delete
   * @returns True if deletion was successful
   */
  public async delete(path: string): Promise<boolean> {
    try {
      await this.callRPC('sys_unlink', { path });
      return true;
    } catch {
      return false;
    }
  }

  public async readUntilExists(path: string, timeout?: number): Promise<Buffer> {
    const start = Date.now();
    while (!((timeout && Date.now() - start > timeout) || (await this.exists(path)))) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return (await this.read(path, false)) as Buffer;
  }
}

export interface NexusListItem {
  /** File/directory name (extracted from path) */
  name: string;
  /** Full path to the file/directory */
  path: string;
  /** Whether this is a directory (1 = directory, 0 = file) */
  isDirectory?: boolean;
  /** Entry type: 0 = file, 1 = directory */
  entry_type?: number;
  /** File size in bytes */
  size?: number;
  /** Last modified timestamp */
  modifiedAt?: string;
  /** ETag for the file */
  etag?: string;
  /** Version number */
  version?: number;
}

export class NexusError extends Error {
  constructor(
    message: string,
    public path?: string
  ) {
    super(message);
  }

  format(): string {
    if (this.path) {
      return `${this.message}: ${this.path}`;
    }
    return this.message;
  }
}

// Singleton instance
let nexusInstance: Nexus | null = null;

/**
 * Get or create Nexus gRPC client instance.
 * Connects to nexusd-cluster on port 2028 (DynamicNexusVfsService).
 */
export function getNexusRpcClient(options?: NexusRpcOptions): Nexus {
  if (!nexusInstance) {
    nexusInstance = new Nexus({
      endpoint: 'http://localhost:12022',
      ...options,
    });
  }
  return nexusInstance;
}
