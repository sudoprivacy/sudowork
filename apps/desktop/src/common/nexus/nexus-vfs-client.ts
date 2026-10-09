/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Nexus RPC Client
 *
 * File I/O client backed by nexusd-cluster gRPC (port 12022).
 * Every file operation is a typed RPC on @nexus-ai-fs/vfs-client — that service
 * IS the kernel boundary for file I/O, and the way through it is the only way
 * through it.
 *
 * The generic Call surface is a different boundary: registry ops (`agent_*`,
 * `get_mount_points`, `service_*`) and `<service>.<method>` plugin dispatch.
 * It does not carry file operations under any spelling — `sys_readdir`,
 * `sys_unlink` and `sys_stat` are rejected exactly like `readdir` and `access`,
 * because a `sys_` prefix on a generic dispatch is a name, not a syscall.
 * Hand-rolling file I/O over it is how `exists`/`list`/`mkdir`/`delete` came to
 * fail silently here. Only `callBinary` remains, for plugin dispatch, which is
 * what that surface is for.
 *
 * Migrated from HTTP JSON-RPC (:12012) to gRPC (:12022) — all callers
 * (safety hooks, etc.) keep the same public API.
 */

import { NexusVfsClient } from '@nexus-ai-fs/vfs-client';

export interface NexusRpcOptions {
  /** gRPC endpoint (default: http://localhost:12022) */
  endpoint?: string;
  /** Auth token for gRPC calls */
  authToken?: string;
}

export class Nexus {
  private readonly client: NexusVfsClient;
  private readonly authToken: string;

  constructor(options?: NexusRpcOptions) {
    const endpoint = options?.endpoint ?? 'http://localhost:12022';
    this.authToken = options?.authToken ?? '';
    this.client = new NexusVfsClient(endpoint);
  }

  /**
   * Binary gRPC Call RPC — dispatches raw protobuf bytes to a service method.
   * Used by NexusSecretClient for vault plugin dispatch.
   */
  public async callBinary(method: string, payload: Buffer): Promise<Buffer> {
    try {
      return await this.client.callBinary(method, payload, this.authToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`RPC error: ${method}: ${msg}`);
    }
  }

  /**
   * Server identity and the zone currently serving, as a typed RPC.
   *
   * A typed RPC, like every other file operation here.
   *
   * Returning `zone_id` is what makes it usable as a liveness check rather than
   * a transport check: it names the zone that answered.
   */
  public async serverInfo(): Promise<{ version?: string; zone_id?: string; uptime_seconds?: string }> {
    try {
      return await this.client.serverInfo(this.authToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`RPC error: serverInfo: ${msg}`);
    }
  }

  public async write(path: string, content: string | Buffer, _if_match?: string, _if_none_match?: boolean, _force?: boolean): Promise<Record<string, unknown>> {
    try {
      const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
      await this.client.write(path, buf, this.authToken);
      return { path, size: buf.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`write failed: ${msg}`, path);
    }
  }

  public async read(path: string, returnMetadata?: boolean): Promise<Buffer | Record<string, unknown>> {
    try {
      const buf = await this.client.read(path, this.authToken);
      if (returnMetadata) {
        // Metadata comes from the typed Stat RPC, not the generic surface.
        const stat = await this.client.stat(path, this.authToken);
        return { content: buf, ...(stat ?? {}) };
      }
      return buf;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`read failed: ${msg}`, path);
    }
  }

  /**
   * Whether a path is there.
   *
   * False means the daemon said "not there". Every other failure throws —
   * losing that distinction is what let a broken call read as a clean absence
   * for months: this used to dispatch `access` through the generic Call
   * surface, which `nexusd-cluster` does not register, and swallow the
   * resulting "unknown Call method" as `false`.
   */
  public async exists(path: string): Promise<boolean> {
    try {
      return await this.client.exists(path, this.authToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`RPC error: exists ${path}: ${msg}`);
    }
  }

  /**
   * Create a directory at the specified path.
   * @param path Directory path to create
   * @param parents If true, create parent directories as needed (like mkdir -p)
   */
  public async mkdir(path: string, parents?: boolean): Promise<void> {
    try {
      await this.client.mkdir(path, this.authToken, { parents: parents ?? true, existOk: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`RPC error: mkdir ${path}: ${msg}`);
    }
  }

  /**
   * List contents of a directory.
   * @param path Directory path to list
   * @returns Array of directory items with name, path, isDirectory, etc.
   */
  public async list(path: string): Promise<NexusListItem[]> {
    let entries;
    try {
      entries = await this.client.readdir(path, this.authToken);
    } catch (err) {
      // Deliberately not `return []`. An empty listing and a failed listing are
      // different facts, and collapsing them is why the safety poller reported
      // "no events" for every event it could not enumerate.
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`RPC error: readdir ${path}: ${msg}`);
    }
    // entryType follows DT_*: 0 file, 1 dir, 2 mount, 4 stream.
    return entries.map((entry) => ({
      path: entry.name,
      name: entry.name.split('/').pop() || entry.name,
      entry_type: entry.entryType,
      isDirectory: entry.entryType === 1,
    }));
  }

  /**
   * Delete a file or directory.
   * @param path Path to delete
   * @returns True if deletion was successful
   */
  public async delete(path: string): Promise<boolean> {
    try {
      await this.client.delete(path, this.authToken);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NexusError(`RPC error: delete ${path}: ${msg}`);
    }
  }
}

export interface NexusListItem {
  /** Basename, which is what callers key on. */
  name: string;
  /** Path exactly as the daemon reported it. */
  path: string;
  /** DT_* code: 0 file, 1 dir, 2 mount, 4 stream. */
  entry_type?: number;
  /** Convenience for the common DT_DIR test. */
  isDirectory?: boolean;
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
