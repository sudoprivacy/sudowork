import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('ws', () => {
  class MockWebSocket {
    on(event: string, callback: (...args: unknown[]) => void) {
      if (event === 'open') queueMicrotask(() => callback());
      return this;
    }
    send() {
      return undefined;
    }
    close() {
      return undefined;
    }
  }
  return { default: MockWebSocket };
});

vi.mock('@/process/bridge/eeclawBridge', () => ({ getValidToken: vi.fn(async () => 'token') }));
vi.mock('@/process/initStorage', () => ({ ProcessConfig: { getSync: vi.fn(() => undefined) } }));
vi.mock('@/process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));

const sessionResponse = {
  ok: true,
  status: 200,
  json: async () => ({ session_id: 's1', ws_url: 'ws://moss.example/s1', work_dir: '/runtime/s1', runtime: { type: 'docker' } }),
};

async function createBody(enabledWikis?: string[]) {
  const fetchMock = vi.fn(async () => sessionResponse) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchMock);
  const { MossWsConnection } = await import('@/agent/remote/MossWsConnection');
  const connection = new MossWsConnection({ serverUrl: 'https://moss.example.com', authToken: 'eyJ.t', assistantName: 'default', enabledWikis }, { onMessage: vi.fn(), onPermissionRequest: vi.fn() });
  await connection.connect();
  const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('enabled_wikis on moss session create', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends enabled_wikis when wikis are selected', async () => {
    expect((await createBody(['w1', 'w2'])).enabled_wikis).toEqual(['w1', 'w2']);
  });

  it('omits enabled_wikis when none are selected', async () => {
    expect(await createBody([])).not.toHaveProperty('enabled_wikis');
    expect(await createBody(undefined)).not.toHaveProperty('enabled_wikis');
  });
});
