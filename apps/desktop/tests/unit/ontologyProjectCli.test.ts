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
  it.each(['project', 'direct'])('discovers and enforces scoped commands with the %s spelling without MCP', async (spelling) => {
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
    const run = async (command: string, args: unknown = {}, options: { isDirect?: boolean; isStdin?: boolean; isUnbound?: boolean; extra?: string[] } = {}) => {
      const input = path.join(directory, 'input.json');
      const envelope = JSON.stringify({ protocolVersion: 1, arguments: args });
      await fs.writeFile(input, envelope);
      const argv = [path.resolve(__dirname, '../../resources/ontology-cli/ontology.cjs'), ...(options.isDirect ? [] : ['project']), command, ...(options.isUnbound ? [] : ['--context', context]), ...(options.isStdin ? [] : ['--input-file', input]), ...(options.extra || [])];
      const execution = { cwd: directory, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
      if (options.isStdin) {
        return new Promise<ReturnType<typeof JSON.parse>>((resolve, reject) => {
          const child = execFile(process.execPath, argv, execution, (_error, stdout) => {
            try {
              resolve(JSON.parse(stdout));
            } catch (error) {
              reject(error);
            }
          });
          child.stdin!.end(envelope);
        });
      }
      try {
        const result = await promisify(execFile)(process.execPath, argv, execution);
        return JSON.parse(result.stdout);
      } catch (error) {
        return JSON.parse((error as { stdout: string }).stdout);
      }
    };
    try {
      if (spelling === 'project') {
        expect((await run('list')).data.commands.map((item: { name: string }) => item.name)).toEqual(['register_source', 'sudograph_contract', 'sudograph_apply', 'sudograph_context', 'sudograph_context_read']);
        expect(await run('sudograph_contract')).toMatchObject({ isSuccess: true, data: { revision: 'r1' } });
        expect(requests[0]).toEqual({ route: '/tool/sudograph_contract', auth: 'Bearer scoped-token', body: { workspaceId: 'registered', input: {} } });
        expect(await run('sudograph_apply', { base_revision: 'r0', operation_id: 'edit-1', model: 'yaml' })).toMatchObject({ isSuccess: false, error: { code: 'MODEL_CONFLICT', recovery: { paths: ['definitions.refund'] } } });
        const source = { operationId: '123e4567-e89b-42d3-a456-426614174000', language: 'en', connector: { kind: 'database', name: 'Fixture', sourceType: 'sqlite', path: '/fixture/source.sqlite', writable: false, metadata: {} } };
        expect(await run('register_source', source)).toMatchObject({ isSuccess: true });
        expect(requests[2]).toEqual({ route: '/tool/register_source', auth: 'Bearer scoped-token', body: { workspaceId: 'registered', input: source } });
        expect(await run('upsert_object', { name: 'bypass' })).toMatchObject({ isSuccess: false, error: { code: 'CAPABILITY_NOT_FOUND' } });
        expect(requests).toHaveLength(3);
      } else {
        // Real fresh-agent calls used catalogue names without the project prefix.
        // Neither this valid spelling nor a typo may inspect the shell workspace.
        const read = { revision: 'r1', context_digest: 'd1', id: 'source:products', records: true, limit: 2 };
        expect(await run('sudograph_context_read', read, { isDirect: true, isStdin: true })).toMatchObject({ isSuccess: true });
        expect(requests[0]).toEqual({ route: '/tool/sudograph_context_read', auth: 'Bearer scoped-token', body: { workspaceId: 'registered', input: read } });
        expect(await run('upsert_object', {}, { isDirect: true })).toMatchObject({ isSuccess: false, error: { code: 'CAPABILITY_NOT_FOUND', recovery: { available_commands: expect.arrayContaining(['sudograph_context']) } } });
        expect(await run('sudograph_context', {}, { isDirect: true, extra: ['--package', directory] })).toMatchObject({ isSuccess: false, error: { code: 'INVALID_ARGUMENTS' } });
        expect(await run('sudograph_context', {}, { isDirect: true, isUnbound: true })).toMatchObject({ isSuccess: false, error: { code: 'INVALID_ARGUMENTS', message: expect.stringContaining('project <command> --context') } });
        expect(requests).toHaveLength(1);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
