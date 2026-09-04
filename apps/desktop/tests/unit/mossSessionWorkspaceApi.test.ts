import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    moss: {
      modelChanged: {
        emit: vi.fn(),
      },
    },
  },
}));

vi.mock('@process/bridge/eeclawBridge', () => ({
  getValidToken: vi.fn(async () => 'token'),
}));

vi.mock('@process/initStorage', () => ({
  ProcessConfig: {
    getSync: vi.fn(() => undefined),
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainError: vi.fn(),
}));

async function createApi(serverUrl = 'https://moss.example.com') {
  const { MossSessionApi } = await import('@/process/remote/MossSessionApi');
  const api = new MossSessionApi(serverUrl);
  api.setAccessToken('token');
  vi.spyOn(api, 'ensureAuthenticated').mockResolvedValue('token');
  return api;
}

describe('MossSessionApi workspace APIs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a session workspace tree with encoded query params', async () => {
    const api = await createApi();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        root: {
          name: 'workspace',
          relativePath: '',
          fullPath: '/runtime/workspace',
          isFile: false,
          isDir: true,
          children: [],
        },
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const tree = await api.getSessionWorkspaceTree('session 1', {
      path: '.drafts',
      search: 'report 2026',
    });

    expect(tree.name).toBe('workspace');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://moss.example.com/api/v1/sessions/session%201/workspace/tree?path=.drafts&search=report+2026',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('loads remote file previews and available skills', async () => {
    const api = await createApi();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          kind: 'text',
          name: 'README.md',
          relativePath: 'README.md',
          mime: 'text/markdown',
          encoding: 'utf8',
          content: '# Readme',
          size: 8,
          truncated: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          skills: [{ name: 'browser', description: 'Browse web pages' }],
        }),
      }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getSessionWorkspaceFile('session-1', { path: 'README.md' })).resolves.toMatchObject({
      kind: 'text',
      content: '# Readme',
    });
    await expect(api.getSessionAvailableSkills('session-1')).resolves.toEqual([{ name: 'browser', description: 'Browse web pages' }]);
  });
});
