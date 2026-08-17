/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACP Transport abstraction — pluggable wire protocols for AcpConnection.
 *
 * StdioAcpTransport: spawn local CLI, communicate via stdin/stdout (default)
 * GrpcAcpTransport:  nexus spawns + supervises the agent; sudowork drives its
 *                    stdio over the nexus VFS gRPC plane (fd streams).
 */

import type { ChildProcess } from 'child_process';
import type { AcpMessage, AcpIncomingMessage } from '@/types/acpTypes';
import { processSupervisor } from '@process/ProcessSupervisor';
import { NexusVfsGrpcClient } from '@common/nexus/nexusVfsGrpcClient';
import { NdjsonParser } from './ndjson';
import { killChild } from './utils';
import { ACP_PERF_LOG } from './perf';
import type { GenericSpawnSpec } from './acpConnectors';

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
    const parser = new NdjsonParser();
    child.stdout?.on('data', (data: Buffer) => {
      for (const message of parser.push(data)) {
        const handleStart = ACP_PERF_LOG ? Date.now() : 0;
        events.onMessage(message);
        if (ACP_PERF_LOG) {
          const handleDuration = Date.now() - handleStart;
          if (handleDuration > 5) {
            console.log(`[ACP-PERF] stream: handleMessage ${handleDuration}ms method=${'method' in message ? (message as AcpIncomingMessage).method : 'response'}`);
          }
        }
      }
    });
  }
}

// ── gRPC tunnel transport (nexus ManagedAgentService) ──────────────

export interface GrpcTransportOptions {
  /** nexus VFS gRPC address, host:port (e.g. 127.0.0.1:2130). */
  endpoint: string;
  /** Loopback plane authenticates with an empty token. */
  authToken: string;
  /** `/agents/{id}/` name, e.g. `<node>-sudowork-<conversationId>`. */
  agentId: string;
  /** What nexus spawns — sudowork owns this spec (SSOT). */
  spawnSpec: GenericSpawnSpec;
  events: AcpTransportEvents;
  /** Idle re-read interval for the non-blocking stdout reader (ms). */
  idlePollMs?: number;
}

/**
 * ACP transport where nexus spawns + supervises the agent and exposes its
 * stdio as VFS fd streams. sudowork drives it over grpc-js:
 *   - start_session (Call) → session_id + os_pid; nexus spawns spawn_spec
 *   - reader: StreamReadAt (non-blocking) /proc/{sid}/fd/1 → NDJSON → onMessage
 *   - writer: StreamWriteNowait /proc/{sid}/fd/0 (agent stdin)
 *   - close:  cancel_v1
 * nexus never parses ACP; NDJSON framing stays here.
 */
export class GrpcAcpTransport implements AcpTransport {
  private client: NexusVfsGrpcClient | null = null;
  private sessionId: string | null = null;
  private osPid: number | null = null;
  private readonly options: GrpcTransportOptions;
  private readonly idlePollMs: number;
  private _connected = false;
  private closing = false;

  constructor(options: GrpcTransportOptions) {
    this.options = options;
    this.idlePollMs = options.idlePollMs ?? 30;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** OS pid of the nexus-spawned agent (auth-proxy token registration / bookkeeping). */
  get pid(): number | undefined {
    return this.osPid ?? undefined;
  }

  /** start_session on nexus (it spawns spawn_spec), then begin the stdout reader. */
  async connect(): Promise<void> {
    try {
      this.client = new NexusVfsGrpcClient(this.options.endpoint, this.options.authToken);
      const res = await this.client.call<{ session_id: string; os_pid?: number | null }>('managed_agent.start_session_v1', {
        agent_id: this.options.agentId,
        spawn_spec: {
          cmd: this.options.spawnSpec.cmd,
          args: this.options.spawnSpec.args,
          env: toStringEnv(this.options.spawnSpec.env),
          cwd: this.options.spawnSpec.cwd,
        },
      });
      this.sessionId = res.session_id;
      this.osPid = res.os_pid ?? null;
      this._connected = true;
      void this.readStdout();
    } catch (error) {
      this.client?.close();
      this.client = null;
      this._connected = false;
      const err = error instanceof Error ? error : new Error(`nexus start_session failed: ${error}`);
      this.options.events.onSetupError(err);
      throw err;
    }
  }

  /** Write one NDJSON-framed ACP message to the agent's stdin stream. */
  send(message: object): void {
    if (!this.client || !this._connected || !this.sessionId) return;
    const line = Buffer.from(JSON.stringify(message) + '\n', 'utf-8');
    this.client.streamWrite(`/proc/${this.sessionId}/fd/0`, line).catch((error) => {
      console.error('[ACP gRPC] stdin write failed:', error);
    });
  }

  /**
   * Non-blocking read loop over the agent's stdout stream. Per the DT_STREAM
   * contract: data → deliver + advance offset + read again immediately;
   * empty (eof=true) → "no data now", retry the SAME offset after a short wait;
   * a rejection (is_error=true = stream closed+drained = agent exited) is the
   * real disconnect.
   */
  private async readStdout(): Promise<void> {
    const stdoutPath = `/proc/${this.sessionId}/fd/1`;
    const parser = new NdjsonParser();
    let offset = '0';
    while (this._connected && this.client) {
      let res;
      try {
        res = await this.client.streamReadAt(stdoutPath, offset, { blocking: false });
      } catch {
        this.handleClose();
        return;
      }
      if (res.data.length > 0) {
        for (const message of parser.push(res.data)) {
          this.options.events.onMessage(message);
        }
        offset = res.nextOffset;
        // immediate re-read (no wait) keeps streaming latency low
      } else {
        await delay(this.idlePollMs);
      }
    }
  }

  private handleClose(): void {
    if (this.closing) return;
    this._connected = false;
    // code/signal not relayed over the tunnel yet (eof only); get_session_v1
    // carries the terminal state when a caller needs crash-vs-clean.
    this.options.events.onClose({ code: 0, signal: null });
  }

  async close(): Promise<void> {
    this.closing = true;
    this._connected = false;
    if (this.client && this.sessionId) {
      try {
        await this.client.call('managed_agent.cancel_v1', { session_id: this.sessionId, mode: 'session' });
      } catch {
        // best-effort cancel + reap
      }
    }
    this.client?.close();
    this.client = null;
  }
}

function toStringEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
