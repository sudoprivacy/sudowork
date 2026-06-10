import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';

const tempDirRef = { path: '' };

vi.mock('electron', () => ({
  app: {
    getPath: (_key: string) => tempDirRef.path,
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    rightPanelBrowser: {
      open: { emit: vi.fn() },
    },
  },
}));

const cdpListTabsMock = vi.fn(() => [] as Array<{ webContentsId: number; url: string; title: string; attached: boolean }>);
const cdpResolveMock = vi.fn(() => null as number | null);

vi.mock('@/process/services/browserPanel/BrowserPanelCdpService', () => ({
  browserPanelCdpService: {
    listTabs: () => cdpListTabsMock(),
    resolveWebContentsId: (_tabId?: string) => cdpResolveMock(),
    navigate: vi.fn(),
    evaluateScript: vi.fn(),
    takeScreenshot: vi.fn(),
    getDomSnapshot: vi.fn(),
    listNetworkRequests: vi.fn(() => []),
    listConsoleMessages: vi.fn(() => []),
  },
}));

import { browserPanelHttpServer } from '@/process/services/browserPanel/BrowserPanelHttpServer';

interface FetchOptions {
  port: number;
  path: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  method?: string;
}

function rawRequest(opts: FetchOptions): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : '';
    const req = http.request(
      {
        host: '127.0.0.1',
        port: opts.port,
        path: opts.path,
        method: opts.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data).toString(),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('BrowserPanelHttpServer', () => {
  beforeEach(async () => {
    tempDirRef.path = await fs.mkdtemp(path.join(os.tmpdir(), 'browserpanel-http-test-'));
    cdpResolveMock.mockReset();
    cdpListTabsMock.mockReset();
    cdpListTabsMock.mockImplementation(() => []);
  });

  afterEach(async () => {
    await browserPanelHttpServer.stop();
    await fs.rm(tempDirRef.path, { recursive: true, force: true });
  });

  it('writes a discovery file with port + token + pid on start', async () => {
    const { discoveryFile, port } = await browserPanelHttpServer.start();
    expect(port).toBeGreaterThan(0);
    const raw = await fs.readFile(discoveryFile, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.port).toBe(port);
    expect(parsed.token).toBe(browserPanelHttpServer.getToken());
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.version).toBeTruthy();
  });

  it('rejects requests without the bearer token with 401', async () => {
    const { port } = await browserPanelHttpServer.start();
    const res = await rawRequest({ port, path: '/tab/list' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong bearer token with 401', async () => {
    const { port } = await browserPanelHttpServer.start();
    const res = await rawRequest({ port, path: '/tab/list', headers: { authorization: 'Bearer wrong-token' } });
    expect(res.status).toBe(401);
  });

  it('accepts /tab/list with the correct bearer token and returns CDP service state', async () => {
    cdpListTabsMock.mockReturnValue([{ webContentsId: 5, url: 'https://example.com', title: 'Example', attached: true }]);
    const { port } = await browserPanelHttpServer.start();
    const token = browserPanelHttpServer.getToken();
    const res = await rawRequest({ port, path: '/tab/list', headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual([{ webContentsId: 5, url: 'https://example.com', title: 'Example', attached: true }]);
  });

  it('returns 405 for GET to a known route', async () => {
    const { port } = await browserPanelHttpServer.start();
    const token = browserPanelHttpServer.getToken();
    const res = await rawRequest({ port, path: '/tab/list', method: 'GET', headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(405);
  });

  it('returns in-body error when there is no active tab', async () => {
    const { port } = await browserPanelHttpServer.start();
    const token = browserPanelHttpServer.getToken();
    cdpResolveMock.mockReturnValue(null);
    const res = await rawRequest({
      port,
      path: '/tab/navigate',
      headers: { authorization: `Bearer ${token}` },
      body: { url: 'https://example.com' },
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/no active browser tab/);
  });

  it('deletes the discovery file on stop', async () => {
    const { discoveryFile } = await browserPanelHttpServer.start();
    await browserPanelHttpServer.stop();
    await expect(fs.access(discoveryFile)).rejects.toThrow();
  });
});
