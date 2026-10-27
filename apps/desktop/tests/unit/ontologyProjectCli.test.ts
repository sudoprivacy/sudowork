import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ontologyProjectCommands } from '@process/services/ontology/ontologyProjectCommands';

describe('ontology authoring CLI', () => {
  it('discovers canonical commands and preserves compiler conflict recovery without MCP', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-project-cli-'));
    const requests: Array<{ route: string; body: unknown; auth: string | undefined }> = [];
    const server = http.createServer(async (request, response) => {
      let input = '';
      for await (const chunk of request) input += String(chunk);
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/commands') return void response.end(JSON.stringify({ ok: true, data: { commands: ontologyProjectCommands('sudograph') } }));
      requests.push({ route: request.url!, body: JSON.parse(input), auth: request.headers.authorization });
      if (request.url === '/tool/sudograph_apply') {
        response.writeHead(409);
        response.end(JSON.stringify({ ok: false, message: 'Same concept changed', code: 'MODEL_CONFLICT', recovery: { paths: ['definitions.refund'] } }));
      } else response.end(JSON.stringify({ ok: true, data: { revision: 'r1' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const context = path.join(directory, 'context.json');
    await fs.writeFile(context, JSON.stringify({ baseUrl: 'http://127.0.0.1:' + (server.address() as AddressInfo).port, token: 'scoped-token', workspaceId: 'registered' }));
    const run = async (command: string, args: unknown = {}) => {
      const input = path.join(directory, 'input.json');
      await fs.writeFile(input, JSON.stringify({ protocolVersion: 1, arguments: args }));
      try {
        const result = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../../resources/ontology-cli/ontology.cjs'), 'project', command, '--context', context, '--input-file', input], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        return JSON.parse(result.stdout);
      } catch (error) {
        return JSON.parse((error as { stdout: string }).stdout);
      }
    };
    try {
      expect((await run('list')).data.commands.map((item: { name: string }) => item.name)).toEqual(['sudograph_contract', 'sudograph_apply', 'sudograph_context', 'sudograph_context_read']);
      expect(await run('sudograph_contract')).toMatchObject({ isSuccess: true, data: { revision: 'r1' } });
      expect(requests[0]).toEqual({ route: '/tool/sudograph_contract', auth: 'Bearer scoped-token', body: { workspaceId: 'registered', input: {} } });
      expect(await run('sudograph_apply', { base_revision: 'r0', operation_id: 'edit-1', model: 'yaml' })).toMatchObject({ isSuccess: false, error: { code: 'MODEL_CONFLICT', recovery: { paths: ['definitions.refund'] } } });
      expect(await run('upsert_object', { name: 'bypass' })).toMatchObject({ isSuccess: false, error: { code: 'CAPABILITY_NOT_FOUND' } });
      expect(requests).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
