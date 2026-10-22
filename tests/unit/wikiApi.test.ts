import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/storage', () => ({
  ConfigStorage: { get: vi.fn(async () => 'https://moss.example.com/') },
}));

import { createEnterpriseMcpClient, EnterpriseMcpError } from '@/renderer/pages/settings/enterprise_mcps/api/client';
import { createWikiApi } from '@/renderer/pages/wiki/api/wikiApi';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('createWikiApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const tokenProvider = vi.fn(async (forceRefresh?: boolean) => (forceRefresh ? 'fresh-token' : 'token'));

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    tokenProvider.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const api = () => createWikiApi(createEnterpriseMcpClient(tokenProvider));
  const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

  it('reads the private tree with a bearer token and a trimmed base url', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { root_id: 'r', nodes: [], usage_bytes: 0, quota_bytes: 10 }));
    const tree = await api().getMyTree();
    const [url, init] = lastCall();
    expect(url).toBe('https://moss.example.com/api/v1/me/documents/tree');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(tree.root_id).toBe('r');
  });

  it('sends snake_case bodies for nodes, documents and wikis', async () => {
    await api().createNode({ parent_id: 'p', name: 'Docs' });
    expect(lastCall()[0]).toBe('https://moss.example.com/api/v1/me/documents/nodes');
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({ parent_id: 'p', name: 'Docs' });

    await api().uploadDocument('n 1', { file_name: 'a.md', content_base64: 'YQ==' });
    expect(lastCall()[0]).toBe('https://moss.example.com/api/v1/me/documents/nodes/n%201/documents');
    expect(lastCall()[1].method).toBe('POST');

    await api().uploadFolder('n', { folder_name: 'docs', on_conflict: 'replace', files: [{ relative_path: 'a/b.md', content_base64: 'Yg==' }] });
    expect(lastCall()[0]).toBe('https://moss.example.com/api/v1/me/documents/nodes/n/folder');
    expect(JSON.parse(String(lastCall()[1].body)).files[0].relative_path).toBe('a/b.md');

    await api().createWiki({ name: 'W', source_mode: 'dir', source_node_ids: ['n'], visible_to: null, build: true });
    expect(JSON.parse(String(lastCall()[1].body))).toMatchObject({ name: 'W', source_mode: 'dir', source_node_ids: ['n'], visible_to: null, build: true });

    await api().setWikiEnabled('w', false);
    expect(lastCall()[0]).toBe('https://moss.example.com/api/v1/me/wikis/w/enabled');
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({ enabled: false });
  });

  it('unwraps list responses and passes the recursive flag', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { documents: [{ id: 'd' }] }));
    const docs = await api().listDocuments('n', true);
    expect(lastCall()[0]).toBe('https://moss.example.com/api/v1/me/documents/nodes/n/documents?recursive=1');
    expect(docs).toEqual([{ id: 'd' }]);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { wikis: [{ id: 'u' }] }));
    expect(await api().listUsableWikis()).toEqual([{ id: 'u' }]);
    expect(lastCall()[0]).toBe('https://moss.example.com/api/v1/wikis/usable');
  });

  it('reads wiki files with per-segment encoding and searches with a query', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: '# hi' }));
    expect(await api().readWikiFile('w', 'sub dir/WIKI.md')).toBe('# hi');
    expect(lastCall()[0]).toBe('https://moss.example.com/api/v1/agent/wikis/w/files/sub%20dir/WIKI.md');

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { matches: [{ file: 'a.md', line_no: 3, line: 'x' }] }));
    const matches = await api().searchWiki('w', 'foo bar');
    expect(lastCall()[0]).toBe('https://moss.example.com/api/v1/agent/wikis/w/search?q=foo+bar');
    expect(matches).toHaveLength(1);
  });

  it('retries once with a refreshed token on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' })).mockResolvedValueOnce(jsonResponse(200, { wikis: [] }));
    await api().listMyWikis();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((lastCall()[1].headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
  });

  it('turns moss error envelopes into EnterpriseMcpError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: { code: 'private_root', message: 'root' } }));
    const err = await api()
      .deleteNode('root')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnterpriseMcpError);
    expect((err as EnterpriseMcpError).code).toBe('private_root');
    expect((err as EnterpriseMcpError).httpStatus).toBe(400);
  });
});
