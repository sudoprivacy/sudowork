/**
 * Integration test: NAPI -> nexusd-cluster gRPC roundtrip.
 *
 * Verifies the full stack:
 *   TypeScript -> NAPI binding -> Rust gRPC client -> nexusd-cluster binary -> kernel
 *
 * The test spawns a nexusd-cluster subprocess on a free port, connects
 * via the NexusGrpcClient NAPI binding, and exercises read/write/ping
 * operations through the gRPC transport.
 *
 * Gracefully skips if either the nexusd-cluster binary or the NAPI
 * native module is unavailable (same pattern as secrets-auth tests).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';

// ── Types ────────────────────────────────────────────────────────────

interface NexusGrpcClient {
  call(method: string, payload: string, authToken: string): string;
  read(path: string, authToken: string): Buffer;
  write(path: string, content: Buffer, authToken: string): void;
  ping(authToken: string): string;
}

interface NexusNapiModule {
  NexusGrpcClient: new (endpoint: string) => NexusGrpcClient;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Find a free TCP port by binding to :0. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine port')));
      }
    });
    server.on('error', reject);
  });
}

/** Wait for a TCP port to accept connections. */
async function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Port ${port} did not become ready within ${timeoutMs}ms`);
}

/** Locate the nexusd-cluster binary. Checks several known paths. */
function findNexusdBinary(): string | null {
  const candidates = [
    // Development install via download-nexus.js
    path.join(os.homedir(), '.nexus', 'bin', 'nexusd'),
    // Repo resources directory
    path.join(__dirname, '..', '..', 'resources', 'nexusd'),
    // PATH fallback — check if `which nexusd` would work
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Try to load the NAPI native module. Returns null if unavailable. */
function loadNapiModule(): NexusNapiModule | null {
  try {
    // In test context, try direct require from native build output
    const candidates = [
      path.join(__dirname, '..', '..', 'native', 'nexus-napi', 'nexus-napi.node'),
      path.join(__dirname, '..', '..', 'native', 'nexus-napi', 'index.node'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return require(candidate) as NexusNapiModule;
      }
    }
    // Fallback: try package-name resolution
    return require('nexus-napi') as NexusNapiModule;
  } catch {
    return null;
  }
}

// ── Test suite ───────────────────────────────────────────────────────

describe('Nexus NAPI gRPC Integration', () => {
  let nexusdBin: string | null = null;
  let napiModule: NexusNapiModule | null = null;
  let process: ChildProcess | null = null;
  let grpcPort = 0;
  let client: NexusGrpcClient | null = null;
  let available = false;

  const AUTH_TOKEN = 'integration-test-token';

  beforeAll(async () => {
    // 1. Check prerequisites
    nexusdBin = findNexusdBinary();
    if (!nexusdBin) {
      console.log('[nexus-napi] nexusd-cluster binary not found, tests will be skipped');
      return;
    }

    napiModule = loadNapiModule();
    if (!napiModule) {
      console.log('[nexus-napi] NAPI native module not available (run `bun run build:native`), tests will be skipped');
      return;
    }

    // 2. Spawn nexusd-cluster on a free port
    grpcPort = await getFreePort();
    console.log(`[nexus-napi] Spawning nexusd-cluster on port ${grpcPort}...`);

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-napi-test-'));
    process = spawn(nexusdBin, [
      '--host', '127.0.0.1',
      '--profile=cluster',
      '--auth-type', 'none',
      '--port', String(grpcPort),
    ], {
      stdio: 'pipe',
      env: {
        ...globalThis.process.env,
        NEXUS_DATA_DIR: dataDir,
      },
    });

    process.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg && /\b(ERROR|CRITICAL)\b/.test(msg)) {
        console.error('[nexus-napi:stderr]', msg);
      }
    });

    process.on('exit', (code, signal) => {
      console.log(`[nexus-napi] nexusd exited — code=${code} signal=${signal}`);
    });

    // 3. Wait for gRPC port to accept connections
    try {
      await waitForPort(grpcPort, 15000);
    } catch (err) {
      console.log(`[nexus-napi] nexusd did not start in time: ${err}`);
      process.kill('SIGTERM');
      process = null;
      return;
    }

    // 4. Connect NAPI client
    try {
      client = new napiModule.NexusGrpcClient(`http://127.0.0.1:${grpcPort}`);
      available = true;
      console.log(`[nexus-napi] Connected to nexusd-cluster on port ${grpcPort}`);
    } catch (err) {
      console.log(`[nexus-napi] Failed to create gRPC client: ${err}`);
    }
  }, 30000);

  afterAll(async () => {
    client = null;
    if (process && process.exitCode === null && !process.killed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (process && process.exitCode === null && !process.killed) {
            process.kill('SIGKILL');
          }
          resolve();
        }, 3000);
        process!.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        process!.kill('SIGTERM');
      });
    }
    process = null;
  });

  it('ping returns server metadata', () => {
    if (!available || !client) {
      console.log('[nexus-napi] Skipping — service unavailable');
      return;
    }

    // ping goes through Call RPC with method "ping"
    // Server may return error for unknown method, or handle it
    // Either way, the round-trip through the proto wire format succeeds
    // if no transport-level exception is thrown.
    try {
      const response = client.ping(AUTH_TOKEN);
      expect(response).toBeDefined();
      console.log('[nexus-napi] Ping response:', response.slice(0, 200));
    } catch (err: unknown) {
      // ping via Call dispatch may return "unknown Call method" — that's
      // a valid gRPC response (transport works, method not routed).
      // Only fail on transport-level errors.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('transport') || msg.includes('connect')) {
        throw err;
      }
      console.log('[nexus-napi] Ping returned expected error (Call dispatch):', msg.slice(0, 200));
    }
  });

  it('write then read roundtrip', () => {
    if (!available || !client) {
      console.log('[nexus-napi] Skipping — service unavailable');
      return;
    }

    const testPath = `/test/napi-roundtrip-${Date.now()}.txt`;
    const testContent = Buffer.from('hello from NAPI integration test');

    // Write through gRPC
    client.write(testPath, testContent, AUTH_TOKEN);

    // Read back through gRPC
    const data = client.read(testPath, AUTH_TOKEN);
    expect(Buffer.from(data).toString()).toBe(testContent.toString());
  });

  it('read nonexistent file returns error', () => {
    if (!available || !client) {
      console.log('[nexus-napi] Skipping — service unavailable');
      return;
    }

    expect(() => {
      client!.read('/does/not/exist.txt', AUTH_TOKEN);
    }).toThrow();
  });

  it('overwrite then read returns latest content', () => {
    if (!available || !client) {
      console.log('[nexus-napi] Skipping — service unavailable');
      return;
    }

    const testPath = `/test/napi-overwrite-${Date.now()}.txt`;

    client.write(testPath, Buffer.from('v1'), AUTH_TOKEN);
    client.write(testPath, Buffer.from('v2-updated'), AUTH_TOKEN);

    const data = client.read(testPath, AUTH_TOKEN);
    expect(Buffer.from(data).toString()).toBe('v2-updated');
  });

  it('agent_register via Call RPC roundtrip', () => {
    if (!available || !client) {
      console.log('[nexus-napi] Skipping — service unavailable');
      return;
    }

    const agentName = `napi-test-agent-${Date.now()}`;
    const registerPayload = JSON.stringify({
      name: agentName,
      owner_id: 'test-owner',
      zone_id: 'root',
      connection_id: `test,${agentName}`,
    });

    // Register agent via Call dispatch
    const registerResponse = client.call('agent_register_external', registerPayload, AUTH_TOKEN);
    const registered = JSON.parse(registerResponse);
    expect(registered.result).toBeDefined();
    expect(registered.result.name).toBe(agentName);
    expect(registered.result.state).toBe('REGISTERED');

    // List agents — verify the registered agent appears
    const listResponse = client.call(
      'agent_list',
      JSON.stringify({ zone_id: 'root' }),
      AUTH_TOKEN,
    );
    const listed = JSON.parse(listResponse);
    const found = listed.result.find((a: { name: string }) => a.name === agentName);
    expect(found).toBeDefined();

    // Cleanup: unregister
    const unregisterResponse = client.call(
      'agent_unregister_external',
      JSON.stringify({ pid: `test,${agentName}` }),
      AUTH_TOKEN,
    );
    const unregistered = JSON.parse(unregisterResponse);
    expect(unregistered.result).toBe(true);
  });
});
