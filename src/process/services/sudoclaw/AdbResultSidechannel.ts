/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sidechannel HTTP server that collects full stdout of ai-dev-browser tool
 * invocations from inside the sudoclaw gateway process, so the sudowork UI
 * and the embedded LLM can both see the real Python output instead of the
 * short `meta` description the gateway forwards over its WebSocket.
 *
 * Lifecycle is tied to the gateway — started before `SudoclawGatewayManager`
 * spawns and stopped when the gateway stops. The port and shared secret are
 * passed into the gateway via `customEnv` as `AI_DEV_BROWSER_SIDECHANNEL_URL`
 * and `AI_DEV_BROWSER_SIDECHANNEL_SECRET`; from there they inherit into
 * whatever `python -m ai_dev_browser.tools.*` children the gateway spawns.
 *
 * The Node-level hook (`hook/node/src/process/AdbStdoutCapture.ts`) POSTs
 * `AdbResultEntry` JSON to `/capture`, authenticating via the shared secret.
 * Agents call `waitForCmd(cmdHash, windowMs)` to reconcile an
 * inbound `tool_call` result event with the captured payload.
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';

export interface AdbResultEntry {
  callId: string;
  cmd: string;
  argv: string[];
  pid: number;
  ppid: number;
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  stdoutRaw: string;
  stdoutJson: unknown;
  cmdHash: string;
}

interface WaiterRecord {
  resolve: (entry: AdbResultEntry | null) => void;
  timer: NodeJS.Timeout;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_ENTRIES = 256;
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_WAIT_MS = 1500;

export class AdbResultSidechannel {
  private server: http.Server | null = null;
  private secret = '';
  private port = 0;
  private readonly byCallId = new Map<string, AdbResultEntry>();
  private readonly byCmdHash = new Map<string, string[]>();
  private readonly insertOrder: string[] = [];
  private readonly waitersByHash = new Map<string, WaiterRecord[]>();
  // Waiters that don't care about cmdHash — they consume the next entry
  // from the global FIFO across all hashes. Used by sudowork when the
  // gateway meta is truncated and we can't reconstruct the hook-side hash.
  private readonly globalWaiters: WaiterRecord[] = [];

  async start(): Promise<{ port: number; secret: string }> {
    if (this.server) {
      return { port: this.port, secret: this.secret };
    }
    this.secret = crypto.randomBytes(32).toString('hex');
    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (err: Error) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      // Bind explicitly to loopback so we never expose the sidechannel on LAN.
      server.listen(0, '127.0.0.1');
    });

    const addr = this.server.address() as AddressInfo | null;
    if (!addr || typeof addr !== 'object') {
      throw new Error('AdbResultSidechannel failed to acquire an address');
    }
    this.port = addr.port;
    mainLog('AdbResultSidechannel', `listening on 127.0.0.1:${this.port}`);
    return { port: this.port, secret: this.secret };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    for (const waiters of this.waitersByHash.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(null);
      }
    }
    this.waitersByHash.clear();
    for (const waiter of this.globalWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.globalWaiters.length = 0;
    this.byCallId.clear();
    this.byCmdHash.clear();
    this.insertOrder.length = 0;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    mainLog('AdbResultSidechannel', 'stopped');
  }

  getEndpoint(): string {
    return `http://127.0.0.1:${this.port}/capture`;
  }

  getSecret(): string {
    return this.secret;
  }

  /**
   * Take an entry by `callId`. Consumes it atomically (removed from the store).
   */
  takeByCallId(callId: string, ttlMs = DEFAULT_TTL_MS): AdbResultEntry | null {
    const entry = this.byCallId.get(callId);
    if (!entry) return null;
    if (Date.now() - entry.finishedAt > ttlMs) {
      this.deleteEntry(callId);
      return null;
    }
    this.deleteEntry(callId);
    return entry;
  }

  /**
   * Wait for the next captured ai-dev-browser entry in global FIFO order
   * (across all cmdHashes). Used when the caller can't reconstruct the
   * hook's hashInput — e.g. the gateway truncates the `meta` field, so the
   * sudowork side can't reproduce the hash the hook computed. Callers that
   * DO have a reliable key should still use `waitForCmd` for precise match.
   */
  async waitForNextAdbEntry(windowMs = DEFAULT_WAIT_MS): Promise<AdbResultEntry | null> {
    const existing = this.popOldest();
    if (existing) return existing;
    if (windowMs <= 0) return null;
    return await new Promise<AdbResultEntry | null>((resolve) => {
      const waiter: WaiterRecord = {
        resolve,
        timer: setTimeout(() => {
          const idx = this.globalWaiters.indexOf(waiter);
          if (idx !== -1) this.globalWaiters.splice(idx, 1);
          resolve(null);
        }, windowMs),
      };
      this.globalWaiters.push(waiter);
    });
  }

  /**
   * Look up an entry by command hash. Falls back to waiting up to
   * `windowMs` for a matching POST to arrive if none is queued yet.
   */
  async waitForCmd(cmdHash: string, windowMs = DEFAULT_WAIT_MS): Promise<AdbResultEntry | null> {
    const existing = this.popByHash(cmdHash);
    if (existing) return existing;

    if (windowMs <= 0) return null;

    return await new Promise<AdbResultEntry | null>((resolve) => {
      const timer = setTimeout(() => {
        this.removeWaiter(cmdHash, waiter);
        resolve(null);
      }, windowMs);
      const waiter: WaiterRecord = { resolve, timer };
      const list = this.waitersByHash.get(cmdHash) ?? [];
      list.push(waiter);
      this.waitersByHash.set(cmdHash, list);
    });
  }

  // ────────────────────────────────────────────────────────────────────────

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST' || req.url !== '/capture') {
      res.writeHead(404);
      res.end();
      return;
    }
    const providedSecret = String(req.headers['x-adb-secret'] ?? '');
    if (!this.secretMatches(providedSecret)) {
      res.writeHead(401);
      res.end();
      return;
    }
    let bodyLen = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      bodyLen += chunk.length;
      if (bodyLen > MAX_BODY_BYTES) {
        res.writeHead(413);
        res.end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let entry: AdbResultEntry | null = null;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        entry = this.parseEntry(raw);
      } catch (err) {
        mainWarn('AdbResultSidechannel', 'failed to parse capture body', err);
      }
      if (!entry) {
        res.writeHead(400);
        res.end();
        return;
      }
      this.storeEntry(entry);
      res.writeHead(204);
      res.end();
    });
    req.on('error', (err) => {
      mainError('AdbResultSidechannel', 'capture request error', err);
    });
  }

  private secretMatches(provided: string): boolean {
    if (!this.secret || !provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(this.secret);
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private parseEntry(raw: string): AdbResultEntry | null {
    const parsed = JSON.parse(raw) as Partial<AdbResultEntry> & Record<string, unknown>;
    if (typeof parsed.callId !== 'string' || typeof parsed.cmd !== 'string' || !Array.isArray(parsed.argv) || typeof parsed.pid !== 'number' || typeof parsed.ppid !== 'number' || typeof parsed.startedAt !== 'number' || typeof parsed.finishedAt !== 'number' || typeof parsed.cmdHash !== 'string' || typeof parsed.stdoutRaw !== 'string') {
      return null;
    }
    const exitCode = parsed.exitCode === null || typeof parsed.exitCode === 'number' ? parsed.exitCode : null;
    return {
      callId: parsed.callId,
      cmd: parsed.cmd,
      argv: parsed.argv.map(String),
      pid: parsed.pid,
      ppid: parsed.ppid,
      startedAt: parsed.startedAt,
      finishedAt: parsed.finishedAt,
      exitCode,
      stdoutRaw: parsed.stdoutRaw,
      stdoutJson: 'stdoutJson' in parsed ? parsed.stdoutJson : undefined,
      cmdHash: parsed.cmdHash,
    };
  }

  private storeEntry(entry: AdbResultEntry): void {
    this.evictStale();
    this.byCallId.set(entry.callId, entry);
    this.insertOrder.push(entry.callId);
    // Priority 1: hash-specific waiter.
    const waiters = this.waitersByHash.get(entry.cmdHash);
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      if (waiters.length === 0) this.waitersByHash.delete(entry.cmdHash);
      this.deleteEntry(entry.callId);
      waiter.resolve(entry);
      return;
    }
    // Priority 2: global FIFO waiter.
    if (this.globalWaiters.length > 0) {
      const waiter = this.globalWaiters.shift()!;
      clearTimeout(waiter.timer);
      this.deleteEntry(entry.callId);
      waiter.resolve(entry);
      return;
    }
    const queue = this.byCmdHash.get(entry.cmdHash) ?? [];
    queue.push(entry.callId);
    this.byCmdHash.set(entry.cmdHash, queue);
    this.evictOverflow();
  }

  private isStale(entry: AdbResultEntry, ttlMs = DEFAULT_TTL_MS): boolean {
    return Date.now() - entry.finishedAt > ttlMs;
  }

  private popOldest(): AdbResultEntry | null {
    // Skip stale entries — an entry left in the queue past its TTL is
    // almost certainly from a prior, unrelated helper invocation that
    // never had a matching tool_call event land; returning it would
    // misattribute its stdout to whatever tool_call is currently
    // waiting, producing the cross-conversation content swap we kept
    // seeing in the lis8 audit (today's `browser --list` showing
    // yesterday's v0.5.1 output).
    while (this.insertOrder.length > 0) {
      const callId = this.insertOrder[0];
      const entry = this.byCallId.get(callId);
      if (!entry) {
        this.insertOrder.shift();
        continue;
      }
      if (this.isStale(entry)) {
        this.deleteEntry(callId);
        continue;
      }
      this.deleteEntry(callId);
      return entry;
    }
    return null;
  }

  private popByHash(cmdHash: string): AdbResultEntry | null {
    // Same TTL guard as `popOldest` — a hash match is worthless if the
    // entry is from a prior session with the same cmd (e.g. a previous
    // `browser --list` before a submodule bump).
    while (true) {
      const queue = this.byCmdHash.get(cmdHash);
      if (!queue || queue.length === 0) return null;
      const callId = queue.shift()!;
      if (queue.length === 0) this.byCmdHash.delete(cmdHash);
      else this.byCmdHash.set(cmdHash, queue);
      const entry = this.byCallId.get(callId);
      if (!entry) continue;
      if (this.isStale(entry)) {
        this.deleteEntry(callId);
        continue;
      }
      this.deleteEntry(callId);
      return entry;
    }
  }

  private deleteEntry(callId: string): void {
    const entry = this.byCallId.get(callId);
    if (!entry) return;
    this.byCallId.delete(callId);
    const idx = this.insertOrder.indexOf(callId);
    if (idx !== -1) this.insertOrder.splice(idx, 1);
    const queue = this.byCmdHash.get(entry.cmdHash);
    if (queue) {
      const qIdx = queue.indexOf(callId);
      if (qIdx !== -1) queue.splice(qIdx, 1);
      if (queue.length === 0) this.byCmdHash.delete(entry.cmdHash);
    }
  }

  private evictStale(ttlMs = DEFAULT_TTL_MS): void {
    const now = Date.now();
    for (const callId of [...this.insertOrder]) {
      const entry = this.byCallId.get(callId);
      if (!entry) continue;
      if (now - entry.finishedAt > ttlMs) this.deleteEntry(callId);
    }
  }

  private evictOverflow(): void {
    while (this.insertOrder.length > MAX_ENTRIES) {
      const oldest = this.insertOrder[0];
      if (!oldest) break;
      this.deleteEntry(oldest);
    }
  }

  private removeWaiter(cmdHash: string, waiter: WaiterRecord): void {
    const list = this.waitersByHash.get(cmdHash);
    if (!list) return;
    const idx = list.indexOf(waiter);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this.waitersByHash.delete(cmdHash);
  }
}
