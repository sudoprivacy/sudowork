/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACP Transport abstraction — pluggable wire protocols for AcpConnection.
 *
 * StdioAcpTransport: spawn local CLI, communicate via stdin/stdout (default)
 * GrpcAcpTransport:  connect to remote ACP server via nexus-vfs gRPC Call RPC
 */

import type { ChildProcess } from 'child_process';
import type { AcpMessage, AcpIncomingMessage } from '@/types/acpTypes';
import { killChild } from './utils';
import { processSupervisor } from '@process/ProcessSupervisor';
import { ACP_PERF_LOG } from './acpConnectors';

// ── Transport interface ────────────────────────────────────────────

export interface AcpTransportEvents {
  /** Called when a parsed JSON-RPC message arrives from the server. */
  onMessage: (message: AcpMessage) => void;
  /** Called when the transport connection closes. */
  onClose: (info: { code: number | null; signal: string | null }) => void;
  /** Called on transport-level errors during setup (spawn failure, etc.). */
  onSetupError: (error: Error) => void;
}

export interface AcpTransport {
  /** Send a JSON-RPC message to the ACP server. */
  send(message: object): void;
  /** Gracefully close the transport and release resources. */
  close(): Promise<void>;
  /** Whether the transport is currently connected. */
  readonly connected: boolean;
}

// ── Stdio transport ────────────────────────────────────────────────

export interface StdioTransportOptions {
  child: ChildProcess;
  isDetached: boolean;
  useLspFraming: boolean;
  backend: string;
  events: AcpTransportEvents;
}

/**
 * Stdio-based ACP transport — the production default.
 *
 * Wraps a spawned child process, parses JSON-RPC from stdout (NDJSON
 * or LSP Content-Length framing), and writes to stdin.
 */
export class StdioAcpTransport implements AcpTransport {
  private child: ChildProcess | null;
  private isDetached: boolean;
  private useLspFraming: boolean;

  // Stderr diagnostics (head + tail for error messages)
  private stderrHead = '';
  private stderrTail = '';

  constructor(options: StdioTransportOptions) {
    this.child = options.child;
    this.isDetached = options.isDetached;
    this.useLspFraming = options.useLspFraming;

    // Register with ProcessSupervisor so the OS-level exit handler will
    // kill this child if the parent exits unexpectedly.
    processSupervisor.track(this.child, this.isDetached);

    this.wireHandlers(options.backend, options.events);
  }

  get connected(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /** PID of the child process (for auth proxy token registration). */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  send(message: object): void {
    if (!this.child?.stdin) return;
    if (this.useLspFraming) {
      const body = JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
      this.child.stdin.write(header + body);
    } else {
      const lineEnding = process.platform === 'win32' ? '\r\n' : '\n';
      this.child.stdin.write(JSON.stringify(message) + lineEnding);
    }
  }

  async close(): Promise<void> {
    if (!this.child) {
      this.isDetached = false;
      return;
    }
    const pid = this.child.pid;
    await killChild(this.child, this.isDetached);
    if (pid) processSupervisor.untrack(pid);
    this.child = null;
    this.isDetached = false;
  }

  /** Collected stderr output for error diagnostics. */
  getStderr(): string {
    if (!this.stderrHead && !this.stderrTail) return '';
    return this.stderrHead + (this.stderrTail && !this.stderrHead.endsWith(this.stderrTail) ? '\n…\n' + this.stderrTail : '');
  }

  // ── Internal wiring ────────────────────────────────────────────

  private wireHandlers(backend: string, events: AcpTransportEvents): void {
    const child = this.child!;
    const STDERR_HEAD_MAX = 512;
    const STDERR_TAIL_MAX = 1536;

    // Stderr collection for diagnostics on early crash
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      console.error(`[ACP ${backend} STDERR]:`, chunk);
      if (this.stderrHead.length < STDERR_HEAD_MAX) {
        this.stderrHead += chunk;
        if (this.stderrHead.length > STDERR_HEAD_MAX) {
          this.stderrHead = this.stderrHead.slice(0, STDERR_HEAD_MAX);
        }
      }
      this.stderrTail += chunk;
      if (this.stderrTail.length > STDERR_TAIL_MAX) {
        this.stderrTail = this.stderrTail.slice(-STDERR_TAIL_MAX);
      }
    });

    // Spawn error — friendlier ENOENT message
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        events.onSetupError(new Error(`'${backend}' CLI not found. Please install it or update the CLI path in Settings.`));
      } else {
        events.onSetupError(error);
      }
    });

    // Process exit
    child.on('exit', (code, signal) => {
      console.error(`[ACP ${backend}] Process exited with code: ${code}, signal: ${signal}`);
      events.onClose({ code, signal });
    });

    // Stdout → JSON-RPC message parsing
    if (this.useLspFraming) {
      this.wireLspReader(child, events);
    } else {
      this.wireNdjsonReader(child, events);
    }
  }

  private wireLspReader(child: ChildProcess, events: AcpTransportEvents): void {
    let lspBuffer = Buffer.alloc(0);
    let expectedLength = -1;
    child.stdout?.on('data', (data: Buffer) => {
      lspBuffer = Buffer.concat([lspBuffer, data]);
      while (lspBuffer.length > 0) {
        if (expectedLength === -1) {
          const bufStr = lspBuffer.toString('utf-8');
          let sepIdx = bufStr.indexOf('\r\n\r\n');
          let sepLen = 4;
          if (sepIdx === -1) {
            sepIdx = bufStr.indexOf('\n\n');
            sepLen = 2;
          }
          if (sepIdx === -1) break;
          const header = bufStr.slice(0, sepIdx);
          const match = header.match(/Content-Length:\s*(\d+)/i);
          if (!match) {
            lspBuffer = Buffer.from(bufStr.slice(sepIdx + sepLen), 'utf-8');
            continue;
          }
          expectedLength = parseInt(match[1], 10);
          lspBuffer = Buffer.from(bufStr.slice(sepIdx + sepLen), 'utf-8');
        }
        if (lspBuffer.length < expectedLength) break;
        const body = lspBuffer.slice(0, expectedLength).toString('utf-8');
        lspBuffer = lspBuffer.slice(expectedLength);
        expectedLength = -1;
        try {
          const handleStart = ACP_PERF_LOG ? Date.now() : 0;
          const message = JSON.parse(body) as AcpMessage;
          events.onMessage(message);
          if (ACP_PERF_LOG) {
            const handleDuration = Date.now() - handleStart;
            if (handleDuration > 5) {
              console.log(`[ACP-PERF] stream: handleMessage ${handleDuration}ms method=${'method' in message ? (message as AcpIncomingMessage).method : 'response'}`);
            }
          }
        } catch {
          // Ignore parsing errors
        }
      }
    });
  }

  private wireNdjsonReader(child: ChildProcess, events: AcpTransportEvents): void {
    let buffer = '';
    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            const handleStart = ACP_PERF_LOG ? Date.now() : 0;
            const message = JSON.parse(line) as AcpMessage;
            events.onMessage(message);
            if (ACP_PERF_LOG) {
              const handleDuration = Date.now() - handleStart;
              if (handleDuration > 5) {
                console.log(`[ACP-PERF] stream: handleMessage ${handleDuration}ms method=${'method' in message ? (message as AcpIncomingMessage).method : 'response'}`);
              }
            }
          } catch {
            // Ignore parsing errors for non-JSON messages
          }
        }
      }
    });
  }
}

// ── gRPC transport ─────────────────────────────────────────────────

/**
 * ACP transport over nexus-vfs gRPC Call RPC.
 *
 * Uses the generic Call RPC as a tunnel: each ACP JSON-RPC message is
 * serialized into CallRequest.payload, and the server's CallResponse
 * carries the reply. Server-initiated messages (session updates,
 * permission requests) are delivered via a polling loop that calls
 * `acp_poll` at a configurable interval during active prompts.
 *
 * Requires the nexus-vfs server to implement `acp_dispatch` and
 * `acp_poll` method handlers (routed through the Call dispatcher).
 */
export interface GrpcTransportOptions {
  endpoint: string;
  authToken: string;
  events: AcpTransportEvents;
  pollIntervalMs?: number;
}

// NexusGrpcClient shape from nexus-napi native module
interface NexusGrpcClient {
  call(method: string, payload: string, authToken: string): string;
  ping(authToken: string): string;
}

export class GrpcAcpTransport implements AcpTransport {
  private client: NexusGrpcClient | null = null;
  private endpoint: string;
  private authToken: string;
  private events: AcpTransportEvents;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;

  constructor(options: GrpcTransportOptions) {
    this.endpoint = options.endpoint;
    this.authToken = options.authToken;
    this.events = options.events;
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
  }

  /** Establish the gRPC connection. Must be called before send(). */
  async connect(): Promise<void> {
    try {
      // Lazy-load nexus-napi to avoid hard dependency when gRPC is unused.
      // The module is a platform-specific native addon (.node) built from
      // native/nexus-napi — only available when the Rust crate is compiled.
      // @ts-expect-error nexus-napi is a platform-specific native addon, not resolvable at type-check time
      const napiModule = await import('nexus-napi');
      this.client = new napiModule.NexusGrpcClient(this.endpoint) as NexusGrpcClient;
      // Verify connectivity with a health check
      this.client.ping(this.authToken);
      this._connected = true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(`gRPC connect failed: ${error}`);
      this.events.onSetupError(err);
      throw err;
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Send an ACP JSON-RPC message via the gRPC Call RPC.
   *
   * The message is tunneled through `acp_dispatch`: the entire ACP
   * JSON-RPC object is the Call payload. The response (if any) is
   * parsed and dispatched to onMessage.
   */
  send(message: object): void {
    if (!this.client || !this._connected) return;
    try {
      const payload = JSON.stringify(message);
      const responseJson = this.client.call('acp_dispatch', payload, this.authToken);
      if (responseJson) {
        try {
          const parsed = JSON.parse(responseJson);
          // Server may batch multiple messages in an array
          // (response + queued session updates)
          if (Array.isArray(parsed)) {
            for (const msg of parsed) {
              this.events.onMessage(msg as AcpMessage);
            }
          } else if (parsed && typeof parsed === 'object') {
            this.events.onMessage(parsed as AcpMessage);
          }
        } catch {
          // Non-JSON response — ignore
        }
      }
    } catch (error) {
      console.error('[ACP gRPC] send failed:', error);
      this._connected = false;
      this.events.onClose({ code: 1, signal: null });
    }
  }

  /**
   * Start polling for server-initiated messages (session updates,
   * permission requests). Called automatically during prompt execution;
   * stopped when the prompt response arrives.
   */
  startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (!this._connected || !this.client) {
        this.stopPolling();
        return;
      }
      try {
        const responseJson = this.client.call('acp_poll', '{}', this.authToken);
        if (responseJson) {
          const messages = JSON.parse(responseJson);
          if (Array.isArray(messages)) {
            for (const msg of messages) {
              this.events.onMessage(msg as AcpMessage);
            }
          }
        }
      } catch {
        // Poll failures are non-fatal — server may not have queued messages
      }
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async close(): Promise<void> {
    this.stopPolling();
    this._connected = false;
    this.client = null;
  }
}
