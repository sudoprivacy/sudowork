/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Nexus RPC Client
 *
 * JSON-RPC 2.0 client for Nexus File System operations.
 * Uses /api/nfs/{method} endpoint for all file operations.
 */

import { randomUUID } from "node:crypto";
import { resolveConfig } from "./config.js";

export interface NexusRpcOptions {
  /** Nexus server URL */
  serverUrl?: string;
  /** API key for authentication */
  apiKey?: string;
}

export class Nexus {
  private readonly serverUrl: string;
  private readonly apiKey: string;

  constructor(options?: NexusRpcOptions) {
    const config = resolveConfig({
      baseUrl: options?.serverUrl,
      apiKey: options?.apiKey,
    });
    this.serverUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  public async callRPC(method: string, params: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`/api/nfs/${method}`, this.serverUrl);
    const rpcRequest: RPCRequest = {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: method,
      params: params,
    };
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(rpcRequest),
      headers: {
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip",
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!response.ok) {
      console.error(`[NexusRPC] API call failed: ${method} - HTTP ${response.status}`);
      throw new Error(`Request failed: ${await response.text()}`);
    }
    const rpcResponse = (await response.json()) as RPCResponse;
    if (rpcResponse.error) {
      console.error(`[NexusRPC] API call RPC error: ${method} - ${rpcResponse.error.message}`);
      throwRPCError(rpcResponse.error);
    }
    return rpcResponse.result;
  }

  public async write(
    path: string,
    content: string | Buffer,
    if_match?: string,
    if_none_match?: boolean,
    force?: boolean,
  ): Promise<Record<string, unknown>> {
    return (await this.callRPC("write", {
      path,
      content,
      if_match,
      if_none_match,
      force,
    })) as Record<string, unknown>;
  }

  public async read(
    path: string,
    returnMetadata?: boolean,
  ): Promise<Buffer | Record<string, unknown>> {
    const result = await this.callRPC("read", { path, return_metadata: returnMetadata });
    if (result && typeof result === "object") {
      const dict = result as Record<string, unknown>;
      if (dict.__type__ === "bytes" && "data" in dict) {
        return Buffer.from(dict.data as string, "base64");
      }
      if ("content" in dict) {
        const content = dict.content;
        const encoding = dict.encoding || "base64";
        let decodedContent: Buffer;
        if (encoding === "base64" && typeof content === "string") {
          decodedContent = Buffer.from(content, "base64");
        } else if (content instanceof Buffer) {
          decodedContent = content;
        } else if (typeof content === "string") {
          decodedContent = Buffer.from(content);
        } else {
          decodedContent = Buffer.from(String(content));
        }
        if (returnMetadata) {
          return { ...dict, content: decodedContent };
        } else {
          return decodedContent;
        }
      }
    }
    if (result instanceof Buffer) {
      return result;
    }
    return result as Record<string, unknown>;
  }

  public async exists(path: string): Promise<boolean> {
    return !!((await this.callRPC("exists", { path })) as { exists?: boolean })?.exists;
  }

  /**
   * Create a directory at the specified path.
   * @param path Directory path to create
   * @param parents If true, create parent directories as needed (like mkdir -p)
   */
  public async mkdir(path: string, parents?: boolean): Promise<void> {
    await this.callRPC("mkdir", { path, parents });
  }

  /**
   * List contents of a directory.
   * @param path Directory path to list
   * @returns Array of directory items with name, path, isDirectory, etc.
   */
  public async list(path: string): Promise<NexusListItem[]> {
    const result = await this.callRPC("list", { path });
    if (result && typeof result === "object") {
      // Nexus returns "files" field for paginated results
      const dict = result as Record<string, unknown>;
      const rawFiles = dict.files || dict.items || [];
      const rawItems = Array.isArray(rawFiles) ? rawFiles : [];

      // Ensure each item has a "name" field (extract from path if missing)
      return rawItems.map((item: unknown): NexusListItem => {
        if (typeof item === "string") {
          // Sometimes items are just path strings
          const itemPath = item;
          return {
            path: itemPath,
            name: itemPath.split("/").pop() || itemPath,
          };
        }
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          // Use path from response, ensure it's a string
          const itemPath = typeof obj.path === "string" ? obj.path : "";
          // Extract name from path if not provided
          const itemName = typeof obj.name === "string"
            ? obj.name
            : itemPath.split("/").pop() || itemPath;
          return {
            ...obj,
            path: itemPath,
            name: itemName,
          } as NexusListItem;
        }
        // Fallback for unexpected item types
        return { path: "", name: "" };
      });
    }
    return [];
  }

  /**
   * Delete a file or directory.
   * @param path Path to delete
   * @returns True if deletion was successful
   */
  public async delete(path: string): Promise<boolean> {
    const result = await this.callRPC("delete", { path });
    if (result && typeof result === "object") {
      const dict = result as { deleted?: boolean };
      return dict.deleted ?? true;
    }
    return true;
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

interface RPCRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface RPCResponse {
  jsonrpc: "2.0";
  id?: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
}

const enum RPCErrorCode {
  // Standard JSON-RPC errors
  INTERNAL_ERROR = -32603,

  // Nexus-specific errors
  FILE_NOT_FOUND = -32000,
  FILE_EXISTS = -32001,
  INVALID_PATH = -32002,
  ACCESS_DENIED = -32003,
  PERMISSION_ERROR = -32004,
  VALIDATION_ERROR = -32005,
  CONFLICT = -32006, // Optimistic concurrency conflict
}

export class NexusError extends Error {
  constructor(
    message: string,
    public path?: string,
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

function throwRPCError(error: RPCResponse["error"]) {
  if (!error) {
    return;
  }
  const code = error.code || RPCErrorCode.INTERNAL_ERROR;
  const message = error.message || "Unknown error";
  switch (code) {
    case RPCErrorCode.FILE_NOT_FOUND:
      throw new NexusError("File not found", (error.data?.path as string) || message);
    case RPCErrorCode.FILE_EXISTS:
      throw new NexusError("File exists", (error.data?.path as string) || message);
    case RPCErrorCode.INVALID_PATH:
      throw new NexusError("Invalid path", (error.data?.path as string) || message);
    case RPCErrorCode.ACCESS_DENIED:
    case RPCErrorCode.PERMISSION_ERROR:
      throw new NexusError("Permission denied", message);
    case RPCErrorCode.VALIDATION_ERROR:
      throw new NexusError("Invalid value", message);
    case RPCErrorCode.CONFLICT:
      const expectedEtag = error.data?.expected_etag || "(unknown)";
      const currentEtag = error.data?.current_etag || "(unknown)";
      const path = (error.data?.path as string) || "unknown";
      throw new NexusError(
        `Conflict detected - file was modified by another agent. Expected etag '${expectedEtag}', but current etag is '${currentEtag}'`,
        path,
      );
    default:
      throw new NexusError(`RPC error: [${code}]: ${message}`);
  }
}

// Singleton instance
let nexusInstance: Nexus | null = null;

/**
 * Get or create Nexus RPC client instance
 * Connects to the local Nexus server on port 12012 (DynamicNexusService)
 */
export function getNexusRpcClient(options?: NexusRpcOptions): Nexus {
  if (!nexusInstance) {
    // Default to local Nexus server port 12012 (matches DynamicNexusService)
    nexusInstance = new Nexus({
      serverUrl: 'http://127.0.0.1:12012',
      ...options,
    });
  }
  return nexusInstance;
}