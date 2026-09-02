/**
 * @license
 * Copyright 2026 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cross-repo contract test for the ACP session/cancel flow.
 *
 * Two tiers:
 *
 * 1. **Protocol tests** (always run when scode binary is available):
 *    Verify the JSON-RPC handshake, session lifecycle, and that
 *    `session/cancel` doesn't crash scode. No API key required.
 *
 * 2. **Live cancel test** (gated on `SUDOWORK_ACP_LIVE_TEST=1`):
 *    Drives a real prompt → cancel → stopReason flow against a
 *    live API. Requires working auth in `sudocode.json`.
 *
 * If no scode binary is available (bare CI checkout that skipped
 * `scode:download`) the suite skips rather than failing red.
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGACY_SCODE_HOME, SCODE_HOME } from '../../src/process/services/scode/scodePaths';

const exeName = process.platform === 'win32' ? 'scode.exe' : 'scode';

function resolveScodeBinary(): string | null {
  const candidates = [process.env.SCODE_BIN, path.join(SCODE_HOME, exeName), path.join(LEGACY_SCODE_HOME, exeName)].filter((p): p is string => !!p);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const scodeBin = resolveScodeBinary();
const describeMaybe = scodeBin ? describe : describe.skip;
const isLive = process.env.SUDOWORK_ACP_LIVE_TEST === '1';
const describeLive = scodeBin && isLive ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Minimal JSON-RPC client over stdio (mirrors sudocode's acp_integration.rs)
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: { notifications: unknown[]; response: Record<string, unknown> }) => void;
  notifications: unknown[];
  id: number;
}

class AcpStdioClient {
  private child: ChildProcess;
  private rl: readline.Interface;
  private nextId = 1;
  private pending: PendingRequest | null = null;
  private buffer: unknown[] = [];

  constructor(bin: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
    this.child = spawn(bin, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.rl = readline.createInterface({ input: this.child.stdout! });
    this.rl.on('line', (line: string) => this.onLine(line));
    this.child.stderr?.resume();
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    if (this.pending) {
      if (typeof msg.id === 'number' && msg.id === this.pending.id) {
        this.pending.resolve({
          notifications: this.pending.notifications,
          response: msg,
        });
        this.pending = null;
      } else {
        this.pending.notifications.push(msg);
      }
    } else {
      this.buffer.push(msg);
    }
  }

  async sendRequest(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<{ notifications: unknown[]; response: Record<string, unknown> }> {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    this.child.stdin!.write(msg);

    return new Promise((resolve, reject) => {
      const buffered = this.buffer.splice(0);
      this.pending = { resolve, notifications: [...buffered], id };

      const timer = setTimeout(() => {
        if (this.pending?.id === id) {
          this.pending = null;
          reject(new Error(`sendRequest(${method}) timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const originalResolve = this.pending.resolve;
      this.pending.resolve = (value) => {
        clearTimeout(timer);
        originalResolve(value);
      };
    });
  }

  sendNotification(method: string, params: Record<string, unknown>): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.child.stdin!.write(msg);
  }

  async shutdown(): Promise<void> {
    this.rl.close();
    this.child.stdin?.end();
    this.child.kill();
    await new Promise<void>((resolve) => {
      this.child.on('exit', () => resolve());
      setTimeout(() => resolve(), 3000);
    });
  }
}

// ---------------------------------------------------------------------------
// Protocol tests — no API key required
// ---------------------------------------------------------------------------

describeMaybe('ACP session/cancel protocol (real scode binary)', () => {
  let workspace: string;
  let configHome: string;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cancel-ws-'));
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cancel-cfg-'));
    // Minimal config — fake API key, just enough for scode to start.
    // Protocol tests below don't send prompts (no API call needed).
    const realConfig = path.join(SCODE_HOME, 'sudocode.json');
    const legacyConfig = path.join(LEGACY_SCODE_HOME, 'sudocode.json');
    const source = fs.existsSync(realConfig) ? realConfig : fs.existsSync(legacyConfig) ? legacyConfig : null;
    if (source) {
      // Copy real config — swap API key to a dummy so no real calls are made.
      const content = fs.readFileSync(source, 'utf-8');
      fs.writeFileSync(path.join(configHome, 'sudocode.json'), content.replace(/"apiKey":\s*"[^"]*"/g, '"apiKey": "sk-test-dummy"'));
    } else {
      // No real config available — skip will be handled by test assertions.
      fs.writeFileSync(path.join(configHome, 'sudocode.json'), '{}');
    }
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(configHome, { recursive: true, force: true });
  });

  function spawnClient(): AcpStdioClient {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SUDO_CODE_CONFIG_HOME: configHome,
      NO_COLOR: '1',
    };
    return new AcpStdioClient(scodeBin!, ['--auth', 'proxy', '--model', 'auto', '--permission-mode', 'danger-full-access', 'acp'], env, workspace);
  }

  it('initialize + session/new handshake succeeds', async () => {
    const client = spawnClient();
    try {
      const init = await client.sendRequest('initialize', { protocolVersion: 1 });
      const result = init.response.result as Record<string, unknown>;
      expect(result.protocolVersion).toBeDefined();
      expect((result.agentInfo as Record<string, unknown>).name).toBe('scode');

      const session = await client.sendRequest('session/new', { cwd: workspace, mcpServers: [] });
      expect(session.response.error).toBeUndefined();
      const sessionResult = session.response.result as Record<string, unknown>;
      expect(sessionResult).toBeDefined();
      expect(sessionResult.sessionId).toBeTruthy();
    } finally {
      await client.shutdown();
    }
  }, 30_000);

  it('session/cancel on idle session does not crash scode', async () => {
    const client = spawnClient();
    try {
      await client.sendRequest('initialize', { protocolVersion: 1 });
      const session = await client.sendRequest('session/new', { cwd: workspace, mcpServers: [] });
      const sessionId = (session.response.result as Record<string, unknown>).sessionId as string;

      // Fire cancel on an idle session — no pending prompt.
      client.sendNotification('session/cancel', { sessionId });

      // If scode crashes, the next request would fail with a closed pipe.
      // Verify the session is still responsive by listing sessions.
      const list = await client.sendRequest('session/list', {});
      const sessions = ((list.response.result as Record<string, unknown>).sessions as unknown[]) ?? [];
      expect(sessions.length).toBeGreaterThan(0);
    } finally {
      await client.shutdown();
    }
  }, 30_000);

  it('session/cancel on unknown sessionId is silently ignored', async () => {
    const client = spawnClient();
    try {
      await client.sendRequest('initialize', { protocolVersion: 1 });
      await client.sendRequest('session/new', { cwd: workspace, mcpServers: [] });

      // Cancel with a bogus session ID — should not crash.
      client.sendNotification('session/cancel', { sessionId: 'nonexistent-session-id' });

      // Verify scode is still alive.
      const list = await client.sendRequest('session/list', {});
      expect(list.response.result).toBeDefined();
    } finally {
      await client.shutdown();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Live cancel test — requires working API auth
// Set SUDOWORK_ACP_LIVE_TEST=1 to enable.
// ---------------------------------------------------------------------------

describeLive('ACP session/cancel live (real scode + real API)', () => {
  let workspace: string;
  let configHome: string;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cancel-live-ws-'));
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cancel-live-cfg-'));
    const realConfig = path.join(SCODE_HOME, 'sudocode.json');
    const legacyConfig = path.join(LEGACY_SCODE_HOME, 'sudocode.json');
    const source = fs.existsSync(realConfig) ? realConfig : fs.existsSync(legacyConfig) ? legacyConfig : null;
    if (!source) throw new Error('No sudocode.json found — cannot run live test');
    fs.copyFileSync(source, path.join(configHome, 'sudocode.json'));
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(configHome, { recursive: true, force: true });
  });

  function spawnClient(): AcpStdioClient {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SUDO_CODE_CONFIG_HOME: configHome,
      NO_COLOR: '1',
    };
    return new AcpStdioClient(scodeBin!, ['--auth', 'proxy', '--model', 'auto', '--permission-mode', 'danger-full-access', 'acp'], env, workspace);
  }

  it('session/cancel mid-turn yields stopReason in prompt response', async () => {
    const client = spawnClient();
    try {
      await client.sendRequest('initialize', { protocolVersion: 1 });
      const session = await client.sendRequest('session/new', { cwd: workspace, mcpServers: [] });
      const sessionId = (session.response.result as Record<string, unknown>).sessionId as string;

      // Send a long-running prompt.
      const promptPromise = client.sendRequest(
        'session/prompt',
        {
          sessionId,
          prompt: [{ type: 'text', text: "Run this exact bash command: printf 'cancel-start'; sleep 60; printf 'cancel-done'" }],
        },
        30_000
      );

      // Wait for scode to start processing.
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Cancel mid-turn.
      client.sendNotification('session/cancel', { sessionId });

      // The prompt response should arrive with stopReason after cancel.
      // If the API is unreachable, promptPromise times out — that's an
      // env issue, not a cancel contract bug. Protocol-level tests above
      // already verify cancel-doesn't-crash.
      const promptResult = await promptPromise;
      const pr = promptResult.response.result as Record<string, unknown>;
      expect(pr).toBeDefined();
      expect(pr.stopReason).toBeDefined();
      expect(['cancelled', 'end_turn']).toContain(pr.stopReason);
    } finally {
      await client.shutdown();
    }
  }, 60_000);
});
