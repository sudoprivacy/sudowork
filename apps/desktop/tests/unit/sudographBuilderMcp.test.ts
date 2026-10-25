import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

describe('Sudograph builder MCP protocol', () => {
  it('offers only checked canonical tools and preserves compiler recovery over stdio', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sudograph-builder-mcp-'));
    const output = path.join(directory, 'builder.cjs');
    const requests: Array<{ route: string; body: unknown; auth: string | undefined }> = [];
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ route: request.url!, body: JSON.parse(Buffer.concat(chunks).toString()), auth: request.headers.authorization });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/tool/sudograph_apply') {
        response.writeHead(409);
        response.end(JSON.stringify({ ok: false, message: 'Same concept changed', code: 'MODEL_CONFLICT', recovery: { paths: ['definitions.refund'] } }));
      } else response.end(JSON.stringify({ ok: true, data: { revision: 'r1' } }));
    });
    const client = new Client({ name: 'sudograph-acceptance', version: '1' });
    try {
      await build({ entryPoints: [path.resolve(__dirname, '../../resources/ontology-builder-mcp/src/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: output, logLevel: 'silent' });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [output],
          env: { ...(process.env as Record<string, string>), ONTOLOGY_WRITE_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, ONTOLOGY_WRITE_TOKEN: 'scoped-token', ONTOLOGY_WORKSPACE_ID: 'registered', ONTOLOGY_MODEL_AUTHORITY: 'sudograph' },
        })
      );
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['sudograph_model_contract', 'sudograph_model_apply', 'sudograph_context', 'sudograph_context_read']);
      expect((await client.callTool({ name: 'sudograph_model_contract', arguments: {} })).isError).toBeUndefined();
      expect(requests[0]).toEqual({ route: '/tool/sudograph_contract', auth: 'Bearer scoped-token', body: { workspaceId: 'registered', input: {} } });
      const result = await client.callTool({ name: 'sudograph_model_apply', arguments: { base_revision: 'r0', operation_id: 'edit-1', model: 'yaml' } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('MODEL_CONFLICT');
      expect(JSON.stringify(result)).toContain('definitions.refund');
      expect((await client.callTool({ name: 'ontology_upsert_object', arguments: { name: 'bypass' } })).isError).toBe(true);
      expect(requests).toHaveLength(2);
    } finally {
      await client.close();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
