/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACP Transport abstraction — pluggable wire protocols for AcpConnection.
 *
 * StdioAcpTransport: spawn local CLI, communicate via stdin/stdout (default)
 * NexusAcpTransport:  nexus spawns + supervises the agent; sudowork drives its
 *                    session through its durable A2A conversation.
 */

import type { ChildProcess } from 'child_process';
import type { NexusSessionEndpoint, NexusSessionTransport, SessionRpcMessage } from '@nexus-ai-fs/vfs-client';
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
  isSensitive?: boolean;
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

    this.wireHandlers(options.backend, options.events, options.isSensitive);
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

  private wireHandlers(backend: string, events: AcpTransportEvents, isSensitive = false): void {
    const child = this.child!;
    const STDERR_HEAD_MAX = 512;
    const STDERR_TAIL_MAX = 1536;

    // Stderr collection for diagnostics on early crash
    child.stderr?.on('data', (data: Buffer) => {
      if (isSensitive) return;
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

// ── Session mailbox transport (nexus ManagedAgentService) ──────────────

export interface NexusTransportOptions {
  endpoint: string;
  authToken: string;
  agentId: string;
  spawnSpec?: GenericSpawnSpec;
  model?: string;
  resumeSessionId?: string;
  events: AcpTransportEvents;
}

/** Both hosting strategies use the shared session mailbox transport. */
export class NexusAcpTransport implements AcpTransport {
  private client: NexusVfsGrpcClient | null = null;
  private mailbox: NexusSessionTransport | null = null;
  private processId: string | null = null;
  private osPid: number | null = null;
  private isClosing = false;

  constructor(private readonly options: NexusTransportOptions) {}

  get connected(): boolean {
    return this.mailbox?.connected ?? false;
  }
  get pid(): number | undefined {
    return this.osPid ?? undefined;
  }

  async connect(): Promise<void> {
    try {
      this.client = new NexusVfsGrpcClient(this.options.endpoint, this.options.authToken);
      const spec = this.options.spawnSpec;
      const response = await this.client.call<{
        session_id: string;
        os_pid?: number | null;
        session_endpoint: NexusSessionEndpoint;
      }>('managed_agent.start_session_v1', {
        agent_id: this.options.agentId,
        ...(spec ? { spawn_spec: { cmd: spec.cmd, args: spec.args, env: toStringEnv(spec.env), cwd: spec.cwd } } : {}),
        ...(this.options.model ? { model: this.options.model } : {}),
        ...(this.options.resumeSessionId ? { resume_session_id: this.options.resumeSessionId } : {}),
      });
      this.processId = response.session_id;
      this.osPid = response.os_pid ?? null;
      if (!response.session_endpoint) throw new Error('Nexus daemon does not support session mailboxes');
      this.mailbox = this.client.openSession(response.session_endpoint, {
        onMessage: (message) => {
          const params = message.params as { text?: unknown } | undefined;
          if (message.method === '_nexus/diagnostic' && typeof params?.text === 'string') console.warn('[ACP stderr]', params.text);
          else this.options.events.onMessage(message as AcpMessage);
        },
        onClose: (error) => {
          if (this.isClosing) return;
          if (error) console.error('[ACP mailbox]', error);
          this.options.events.onClose({ code: null, signal: null });
          void this.close();
        },
      });
      this.mailbox.start();
    } catch (error) {
      await this.close();
      const failure = error instanceof Error ? error : new Error(String(error));
      this.options.events.onSetupError(failure);
      throw failure;
    }
  }

  send(message: object): void {
    if (!this.mailbox) throw new Error('Session mailbox is not connected');
    void this.mailbox.send(message as SessionRpcMessage).catch((error: unknown) => {
      console.error('[ACP mailbox] send failed:', error);
    });
  }

  async close(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;
    try {
      await this.mailbox?.close().catch(() => {});
      if (this.client && this.processId) {
        await this.client.call('managed_agent.cancel_v1', { session_id: this.processId, mode: 'session' }).catch(() => {});
      }
    } finally {
      this.client?.close();
      this.client = null;
      this.mailbox = null;
    }
  }
}

function toStringEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
