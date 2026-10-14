import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BROWSER_FILE_LIMIT, downloadBrowserFile, uploadBrowserFile } from '@sudowork/moss-client';

describe('shared browser binary transport', () => {
  it('preserves bytes and Unicode names, selects the current credential, and never replays a rejected upload', async () => {
    const data = Buffer.from('browser receipt\u0000\u00ff');
    const fileId = 'a'.repeat(32);
    const calls: { method?: string; url?: string; token?: string; name?: string; data: Buffer }[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      calls.push({ method: req.method, url: req.url, token: req.headers.authorization, name: req.headers['x-browser-file-name'] as string | undefined, data: Buffer.concat(chunks) });
      if (req.headers.authorization === 'Bearer revoked') {
        res.writeHead(403);
        res.end('{"error":"forbidden"}');
        return;
      }
      if (req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ file: { id: fileId, name: '报告.txt', bytes: data.length, kind: 'upload', sha256: createHash('sha256').update(data).digest('hex') } }));
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(data);
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const ctx = { baseUrl: `http://127.0.0.1:${address.port}`, accessToken: 'owner' };
    try {
      const input = { name: '报告.txt', controlEpoch: 2, targetEpoch: 3 };
      const file = await uploadBrowserFile(ctx, 'session/a', input, data);
      expect(file.id).toBe(fileId);
      expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/sessions/session%2Fa/browser/files/upload', token: 'Bearer owner', name: encodeURIComponent(input.name), data });
      const downloaded = await downloadBrowserFile({ ...ctx, accessToken: 'fresh-owner' }, 'session/a', fileId);
      expect(Buffer.from(downloaded)).toEqual(data);
      expect(calls[1].token).toBe('Bearer fresh-owner');
      await expect(uploadBrowserFile({ ...ctx, accessToken: 'revoked' }, 'session/a', input, data)).rejects.toMatchObject({ status: 403 });
      expect(calls).toHaveLength(3);
      await expect(downloadBrowserFile(ctx, 'session/a', '../another-owner')).rejects.toThrow('browser_file_not_found');
      await expect(uploadBrowserFile(ctx, 'session/a', input, new Uint8Array(BROWSER_FILE_LIMIT + 1))).rejects.toThrow('browser_files_too_large');
      expect(calls).toHaveLength(3);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
