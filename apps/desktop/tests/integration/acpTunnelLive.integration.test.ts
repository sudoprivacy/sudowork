/**
 * Published daemon -> production GrpcAcpTransport -> published scode -> real API.
 * Opt in with SUDOWORK_ACP_TUNNEL_E2E=1 (protocol) or
 * SUDOWORK_ACP_TUNNEL_LIVE=1 (also spends API credits). See acp-tunnel-live.md.
 * No transport, daemon, agent, or model is substituted. Only Electron's shell
 * is supplied by the repository's shared Node test setup.
 */
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NexusVfsClient } from '@nexus-ai-fs/vfs-client';
import { GrpcAcpTransport } from '../../src/agent/acp/transport';
import { killChild } from '../../src/agent/acp/utils';
import versions from '../../src/shared/runtime-versions.json';

const isLive = process.env.SUDOWORK_ACP_TUNNEL_LIVE === '1';
const isEnabled = isLive || process.env.SUDOWORK_ACP_TUNNEL_E2E === '1';
const suite = isEnabled ? describe : describe.skip;
const model = process.env.SUDOWORK_ACP_TEST_MODEL || 'claude-sonnet-4-6';

interface IRpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** Drive the actual transport; reject outstanding requests on disconnect. */
class TunnelClient {
  readonly transport: GrpcAcpTransport;
  readonly updates: IRpcMessage[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  error: Error | undefined;

  constructor(endpoint: string, scode: string, cwd: string, configHome: string) {
    // scode's shell tool invokes `sh`. Windows CI/dev installs Git Bash, but
    // its bin directory need not be in the parent terminal's PATH.
    const shellDir = process.env.SUDOWORK_ACP_SHELL_DIR || (process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin') : '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
    env.PATH = [shellDir, process.env.PATH].filter(Boolean).join(path.delimiter);
    if (isLive) execFileSync('sh', ['-lc', 'exit 0'], { env, timeout: 10_000, windowsHide: true });
    this.transport = new GrpcAcpTransport({
      endpoint,
      authToken: '',
      agentId: `sudowork-e2e-${randomUUID()}`,
      spawnSpec: {
        cmd: scode,
        args: ['--auth', 'proxy', '--model', model, '--permission-mode', 'danger-full-access', 'acp'],
        cwd,
        shell: false,
        env: { ...env, SUDO_CODE_CONFIG_HOME: configHome, NO_COLOR: '1', NEXUS_AGENT_ID: '', NEXUS_GRPC_ENDPOINT: '' },
      },
      events: {
        onMessage: (message) => this.onMessage(message as IRpcMessage),
        onSetupError: (error) => this.onError(error),
        onClose: () => this.onError(new Error('ACP tunnel disconnected')),
      },
    });
  }

  private onError(error: Error): void {
    this.error = error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private onMessage(message: IRpcMessage): void {
    if (message.method) {
      this.updates.push(message);
      if (message.id !== undefined) {
        // File/terminal capabilities are not advertised; scode owns its tools.
        // An unexpected permission/client request must fail, never hang or auto-approve.
        this.transport.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unexpected client request: ${message.method}` } });
        this.onError(new Error(`Unexpected client request: ${message.method}`));
      }
      return;
    }
    const request = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (!request) return;
    this.pending.delete(message.id as number);
    if (message.error) request.reject(new Error(`ACP ${message.error.code}: ${message.error.message}`));
    else request.resolve(message.result ?? {});
  }

  async request(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    if (this.error) throw this.error;
    const id = this.nextId++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}; recent session updates: ${JSON.stringify(this.updates.slice(-8)).slice(-12_000)}`)), timeoutMs);
        this.transport.send({ jsonrpc: '2.0', id, method, params });
      });
    } finally {
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }

  prompt(sessionId: string, text: string): Promise<Record<string, unknown>> {
    return this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 120_000);
  }

  async close(): Promise<void> {
    this.onError(new Error('Test client closed'));
    await this.transport.close();
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

suite('published scode over the real ACP tunnel', () => {
  let root: string;
  let workspace: string;
  let configHome: string;
  let endpoint: string;
  let scode: string;
  let daemon: ChildProcess | undefined;
  let daemonLog = '';
  const clients: TunnelClient[] = [];

  beforeAll(async () => {
    const suffix = process.platform === 'win32' ? '.exe' : '';
    scode = process.env.SCODE_BIN || path.join(os.homedir(), '.nexus', 'sudowork', 'sudocode', `scode${suffix}`);
    const cluster = process.env.NEXUS_CLUSTER_BIN || path.join(os.homedir(), '.nexus-vfs', 'bin', `nexusd-cluster${suffix}`);
    for (const [binary, version] of [
      [scode, process.env.SUDOWORK_ACP_SCODE_VERSION || versions.scode],
      [cluster, versions['nexusd-cluster']],
    ]) {
      expect(fs.existsSync(binary), `Missing published binary: ${binary}`).toBe(true);
      const banner = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true }).trim();
      expect(banner, 'Binary must match runtime-versions.json').toMatch(new RegExp(`(?:^|\\s)v?${version.replaceAll('.', '\\.')}\\b`));
      console.log(`[artifact] ${banner}`);
    }
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-acp-live-'));
    workspace = path.join(root, 'workspace');
    configHome = path.join(root, 'config');
    fs.mkdirSync(workspace);
    fs.mkdirSync(configHome);
    // Only copy the selected account into our isolated home. Never inherit
    // personal MCP servers, hooks, plugins, or project configuration.
    let account = { apiKey: 'protocol-only-no-network', baseUrl: 'http://127.0.0.1:1' };
    if (isLive) {
      const source = process.env.SUDOWORK_ACP_LIVE_CONFIG;
      if (!source) throw new Error('Live mode requires SUDOWORK_ACP_LIVE_CONFIG (path to sudocode.json)');
      const config = JSON.parse(fs.readFileSync(source, 'utf8'));
      const profile = process.env.SUDOWORK_ACP_LIVE_PROFILE || 'sudorouter';
      account = config.auth_modes?.proxy?.[profile];
      if (!account?.apiKey || !account?.baseUrl) throw new Error(`Missing proxy profile ${profile} in live config`);
    }
    fs.writeFileSync(path.join(configHome, 'sudocode.json'), JSON.stringify({ auth_modes: { proxy: { e2e: account } }, models: { [model]: { name: model, providers: { proxy: { model } } } } }), { mode: 0o600 });
    fs.writeFileSync(path.join(configHome, 'settings.json'), JSON.stringify({ auth_profile: 'e2e', model }));
    endpoint = `127.0.0.1:${await freePort()}`;
    daemon = spawn(cluster, ['--bind-addr', endpoint, '--data-dir', path.join(root, 'daemon'), '--no-tls', '--insecure-no-auth'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NEXUS_IDENTITY_DIR: path.join(root, 'identity'), NEXUS_PEERS: '' } });
    daemon.stdout!.on('data', (chunk: Buffer) => {
      daemonLog = (daemonLog + chunk.toString()).slice(-12_000);
    });
    daemon.stderr!.on('data', (chunk: Buffer) => {
      daemonLog = (daemonLog + chunk.toString()).slice(-12_000);
    });
    let spawnError: Error | undefined;
    daemon.on('error', (error) => {
      spawnError = error;
    });
    const probe = new NexusVfsClient(endpoint, { connectTimeoutMs: 1000 });
    try {
      await waitFor(async () => {
        if (spawnError) throw spawnError;
        if (daemon?.exitCode !== null) throw new Error(`Daemon exited: ${daemonLog}`);
        try {
          const info = await probe.serverInfo('');
          return Boolean(info.zone_id);
        } catch {
          return false;
        }
      }, 'daemon serverInfo');
    } finally {
      probe.close();
    }
  }, 60_000);

  afterAll(async () => {
    try {
      // A failed regression assertion must not leave our fixture running.
      // Keep this after the test so cleanup cannot satisfy its exit assertion.
      const marker = workspace && path.join(workspace, 'cancel-started');
      if (marker && fs.existsSync(marker)) {
        const { pid } = JSON.parse(fs.readFileSync(marker, 'utf8')) as { pid: number };
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // The successful cancellation path has already reaped this process.
          }
        }
      }
      for (const client of clients) await client.close();
    } finally {
      if (daemon) await killChild(daemon, false);
      if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, 30_000);

  async function openSession(): Promise<{ client: TunnelClient; sessionId: string }> {
    const client = new TunnelClient(endpoint, scode, workspace, configHome);
    clients.push(client);
    await client.transport.connect();
    expect(client.transport.pid).toBeGreaterThan(0);
    const init = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'sudowork-live-e2e', version: '1' } });
    expect(init.protocolVersion).toBe(1);
    const session = await client.request('session/new', { cwd: workspace, mcpServers: [] });
    expect(session.sessionId).toEqual(expect.any(String));
    expect(String(session.sessionId).length).toBeGreaterThan(0);
    return { client, sessionId: String(session.sessionId) };
  }

  it('initializes a real scode session, cancels idle work, and opens another session', async () => {
    const { client, sessionId } = await openSession();
    try {
      client.transport.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
      const next = await client.request('session/new', { cwd: workspace, mcpServers: [] });
      expect(next.sessionId).toEqual(expect.any(String));
      expect(next.sessionId).not.toBe(sessionId);
      expect(client.error).toBeUndefined();
    } finally {
      const pid = client.transport.pid!;
      await client.close();
      expect(client.transport.connected).toBe(false);
      await waitFor(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      }, 'managed scode process reaped');
    }
  }, 60_000);

  it('observes a crashed scode process and can start a replacement session', async () => {
    const { client } = await openSession();
    process.kill(client.transport.pid!, 'SIGKILL');
    await waitFor(() => Boolean(client.error), 'tunnel reports child exit');
    expect(client.transport.connected).toBe(false);
    await expect(client.request('session/new', { cwd: workspace, mcpServers: [] })).rejects.toThrow('disconnected');
    await client.close();
    const replacement = await openSession();
    expect(replacement.client.transport.connected).toBe(true);
    expect(replacement.client.error).toBeUndefined();
    await replacement.client.close();
  }, 60_000);

  it.skipIf(!isLive)(
    'reads real input, writes a deliverable, survives idle, cancels a running tool, and continues',
    async () => {
      const token = randomUUID();
      fs.writeFileSync(path.join(workspace, 'input.json'), JSON.stringify({ token, quantities: [13, 29, 7] }));
      const { client, sessionId } = await openSession();
      const first = await client.prompt(sessionId, 'Read input.json from the working directory using your file tools. Write result.json with exactly {"token": <the token you read>, "total": <sum of quantities>}. Do the actual file operations, then briefly confirm.');
      expect(first.stopReason).toBe('end_turn');
      expect(JSON.parse(fs.readFileSync(path.join(workspace, 'result.json'), 'utf8'))).toEqual({ token, total: 49 });
      expect(client.updates.some((message) => (message.params?.update as Record<string, unknown>)?.sessionUpdate === 'agent_message_chunk')).toBe(true);
      console.log('[live] model read input and wrote verified result');

      // Cross the production 30-second long-poll expiry, then use the SAME session.
      await new Promise((resolve) => setTimeout(resolve, 36_000));
      expect(client.error).toBeUndefined();
      const second = await client.prompt(sessionId, 'Read result.json that you just created. Write continued.json with the same token and total multiplied by 2. Do the actual file operations.');
      expect(second.stopReason).toBe('end_turn');
      expect(JSON.parse(fs.readFileSync(path.join(workspace, 'continued.json'), 'utf8'))).toEqual({ token, total: 98 });
      console.log('[live] same session continued after long-poll timeout');

      // Wait for proof that the real shell tool started, not an arbitrary delay.
      fs.writeFileSync(
        path.join(workspace, 'cancel-work.cjs'),
        `const fs = require('fs'); const path = require('path'); fs.writeFileSync(path.join(__dirname, 'cancel-started'), JSON.stringify({token: '${token}', pid: process.pid})); setTimeout(() => fs.writeFileSync(path.join(__dirname, 'cancel-finished'), 'unexpected'), 60000);`
      );
      const nodeCommand = `"${process.execPath.replaceAll('\\', '/')}" "${path.join(workspace, 'cancel-work.cjs').replaceAll('\\', '/')}"`;
      const running = client.prompt(sessionId, `Run this exact command using your shell tool: ${nodeCommand}. Wait for it to finish in the foreground. Do not read or edit the script, do not run it in the background, and do not impose a short timeout.`);
      let promptError: Error | undefined;
      let isPromptFinished = false;
      void running.then(
        () => {
          isPromptFinished = true;
        },
        (error: Error) => {
          promptError = error;
        }
      );
      await waitFor(
        () => {
          if (client.error) throw client.error;
          if (promptError) throw promptError;
          const marker = path.join(workspace, 'cancel-started');
          const isStarted = fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).token === token;
          if (!isStarted && isPromptFinished) {
            const updates = client.updates.map((message) => message.params?.update as Record<string, unknown>);
            const text = updates.map((update) => (update?.content as { text?: string })?.text || '').join('');
            const tools = updates.filter((update) => String(update?.sessionUpdate).startsWith('tool_call'));
            throw new Error(`Prompt ended before the tool started: ${JSON.stringify({ text, tools }).slice(-8000)}`);
          }
          return isStarted;
        },
        'model started the cancellable command',
        90_000
      );
      client.transport.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
      expect((await running).stopReason).toBe('cancelled');
      const toolPid = JSON.parse(fs.readFileSync(path.join(workspace, 'cancel-started'), 'utf8')).pid as number;
      expect(toolPid).toBeGreaterThan(0);
      await waitFor(
        () => {
          try {
            process.kill(toolPid, 0);
            return false;
          } catch {
            return true;
          }
        },
        'cancelled tool descendant exited',
        10_000
      );
      expect(fs.existsSync(path.join(workspace, 'cancel-finished'))).toBe(false);
      const recovered = await client.prompt(sessionId, 'Read continued.json. Copy its token and total into recovered.json, adding "recovered": true. Do the actual file operations.');
      expect(recovered.stopReason).toBe('end_turn');
      expect(JSON.parse(fs.readFileSync(path.join(workspace, 'recovered.json'), 'utf8'))).toEqual({ token, total: 98, recovered: true });
      expect(client.error).toBeUndefined();
      console.log('[live] running tool cancelled; same session produced verified recovery file');
    },
    420_000
  );
});
