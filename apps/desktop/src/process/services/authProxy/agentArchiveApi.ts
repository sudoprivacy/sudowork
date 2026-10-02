import type { IncomingMessage, ServerResponse } from 'node:http';
import { mossCatalogIdentity, assertMossCatalogIdentity } from '@process/services/mossCatalogApi';

/** Forward a skill's private archive requests using the signed-in account, keeping its token in the host. */
export async function onAgentArchiveRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const route = pathname.match(/^\/agent-archives(?:\/(user-[a-f0-9]{16}-[a-f0-9-]{36})(?:\/(complete|chunks)(?:\/(\d+))?)?)?$/);
  if (!route || !['GET', 'POST', 'PUT'].includes(req.method || '')) {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const bytes of req) {
      size += bytes.length;
      if (size > 4 * 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(Buffer.from(bytes));
    }
    const identity = mossCatalogIdentity();
    const { getValidToken } = await import('@process/bridge/eeclawBridge');
    const token = await getValidToken();
    assertMossCatalogIdentity(identity);
    const body = Buffer.concat(chunks);
    const response = await fetch(`${identity.server}/api/v1/agents/private-archives${pathname.slice('/agent-archives'.length)}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': req.method === 'PUT' ? 'application/octet-stream' : 'application/json',
        ...(typeof req.headers['x-content-sha256'] === 'string' ? { 'X-Content-SHA256': req.headers['x-content-sha256'] } : {}),
      },
      ...(req.method === 'GET' ? {} : { body }),
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    });
    const result = Buffer.from(await response.arrayBuffer());
    assertMossCatalogIdentity(identity);
    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(result);
  } catch {
    if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Private backup service unavailable. Check the signed-in cloud account.' }));
  }
}
