import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** Stdio-only ACP hosts use the same authenticated Desktop HTTP coordinator. */
const endpoint = process.env.SUDOWORK_BROWSER_MCP_URL || '';
const token = process.env.SUDOWORK_BROWSER_MCP_TOKEN || '';
const url = new URL(endpoint);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/mcp' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid shared browser transport configuration');
delete process.env.SUDOWORK_BROWSER_MCP_TOKEN;
const closing = new AbortController();
let sequence = 0;

async function forward(method: string, params: unknown, signal?: AbortSignal) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
    signal: AbortSignal.any([closing.signal, AbortSignal.timeout(90_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error('Shared browser connection failed');
  const value = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  if (value.error || !value.result) throw new Error('Shared browser request failed');
  return value.result;
}

const server = new Server({ name: 'sudowork-browser', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => forward('tools/list', request.params || {}, extra.signal) as Promise<{ tools: Array<{ name: string; inputSchema: { type: 'object' } }> }>);
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => forward('tools/call', request.params, extra.signal));
process.stdin.on('end', () => {
  closing.abort();
  void server.close();
});
process.on('SIGTERM', () => {
  closing.abort();
  void server.close();
});
void server.connect(new StdioServerTransport()).catch(() => {
  console.error('Shared browser stdio transport could not start');
  process.exitCode = 1;
});
