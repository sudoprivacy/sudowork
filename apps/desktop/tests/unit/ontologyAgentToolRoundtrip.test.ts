import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildOntologyArtifact } from '@sudowork/ontology-runtime/artifact';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { expect, it } from 'vitest';

const binary = process.env.SUDOCODE_TEST_BINARY || path.join(os.homedir(), '.nexus/sudowork/sudocode/scode');

it.skipIf(!existsSync(binary))(
  'round-trips ontology scripts through the native shell and restores history without MCP',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-agent-roundtrip-'));
    const workspace = path.join(root, 'workspace');
    const config = path.join(root, 'config');
    await fs.mkdir(workspace);
    await fs.mkdir(config);
    const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'northwind', title: 'Northwind' });
    snapshot.logicFunctions = [
      {
        id: 'lookup',
        code: 'product_lookup',
        name: 'Products',
        displayName: 'Products',
        description: 'Product lookup',
        displayDescription: 'Product lookup',
        runtime: 'typescript',
        objectIds: [],
        signature: 'lookup()',
        returnType: 'object[]',
        body: 'return [];',
        parameters: [],
        configuration: {},
        origin: 'manual',
        status: 'active',
        executionCount: 0,
        updatedAt: 1,
      },
    ];
    const artifact = await buildOntologyArtifact(snapshot, { root: path.join(root, 'artifacts'), cliFile: path.resolve(__dirname, '../../resources/ontology-cli/ontology.cjs') });
    const shellCommand = [process.execPath, path.join(artifact.directory, 'scripts/ontology.cjs'), 'list', '--package', artifact.directory].map((value) => JSON.stringify(value)).join(' ');
    let selectedTool = '';
    const requests: Array<Record<string, any>> = [];
    const provider = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'auto' }] }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any>;
      requests.push(body);
      const names = [...(body.tools || []).map((tool: any) => tool.function?.name), ...(body.messages || []).flatMap((message: any) => (message.tool_calls || []).map((tool: any) => tool.function?.name))].filter(Boolean) as string[];
      if (names.some((name) => name.length > 64)) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Tool name exceeds 64 characters' } }));
        return;
      }
      const shellTool = (body.tools || []).find((tool: any) => /^bash$/i.test(tool.function?.name || '') && tool.function?.parameters?.properties?.command);
      if (shellTool) selectedTool = shellTool.function.name;
      const toolName = selectedTool;
      const isToolCall = requests.length === 1;
      const delta = isToolCall ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-ontology', type: 'function', function: { name: toolName, arguments: JSON.stringify({ command: shellCommand }) } }] } : { role: 'assistant', content: 'Northwind product_lookup is available.' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'completion', object: 'chat.completion.chunk', model: 'auto', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ id: 'completion', object: 'chat.completion.chunk', model: 'auto', choices: [{ index: 0, delta: {}, finish_reason: isToolCall ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const port = (provider.address() as { port: number }).port;
    const configPath = path.join(config, 'sudocode.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        default_model: 'auto',
        auth_modes: { proxy: { sudorouter: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'fixture-key' } } },
        models: { auto: { alias: 'auto', name: 'Fixture', input: ['text'], providers: { proxy: { provider: 'sudorouter', model: 'auto', api: 'openai-completions' } } } },
      })
    );
    const mcpServers: unknown[] = [];

    function start() {
      const child = spawn(binary, ['--auth', 'proxy', '--model', 'auto', 'acp'], {
        cwd: workspace,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, SUDO_CODE_CONFIG_HOME: config, SUDOCODE_CONFIG_PATH: configPath, PROXY_BASE_URL: `http://127.0.0.1:${port}/v1`, PROXY_AUTH_TOKEN: 'fixture-key', SUDOCODE_DISABLE_CRON_TOOLS: '1' },
        stdio: 'pipe',
      });
      const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
      let id = 0;
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        const message = JSON.parse(line);
        if (message.method === 'session/request_permission') {
          const option = message.params.options.find((item: { kind: string }) => item.kind === 'allow_once');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } } }) + '\n');
        }
        const request = pending.get(message.id);
        if (!request || (!('result' in message) && !('error' in message))) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      });
      const closed = new Promise<void>((resolve) =>
        child.once('close', () => {
          for (const request of pending.values()) {
            clearTimeout(request.timer);
            request.reject(new Error(stderr || 'Sudocode exited'));
          }
          pending.clear();
          resolve();
        })
      );
      return {
        request: (method: string, params: Record<string, unknown>) =>
          new Promise<any>((resolve, reject) => {
            const requestId = id++;
            pending.set(requestId, {
              resolve,
              reject,
              timer: setTimeout(() => {
                pending.delete(requestId);
                reject(new Error(`${method} timed out: ${stderr}`));
              }, 20000),
            });
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
          }),
        close: async () => {
          child.kill('SIGTERM');
          await closed;
          lines.close();
        },
      };
    }
    let agent = start();
    try {
      await agent.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
      const { sessionId } = await agent.request('session/new', { cwd: workspace, mcpServers });
      expect(await agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'List Northwind logic functions.' }] })).toMatchObject({ stopReason: 'end_turn' });
      expect(requests).toHaveLength(2);
      expect(
        requests[1].messages.some((message: any) => message.role === 'tool' && JSON.stringify(message).includes('product_lookup')),
        JSON.stringify({ selectedTool, tools: requests[0].tools.map((tool: any) => ({ name: tool.function?.name, properties: Object.keys(tool.function?.parameters?.properties || {}) })), responses: requests[1].messages.filter((message: any) => message.role === 'tool') })
      ).toBe(true);
      await agent.close();
      agent = start();
      await agent.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
      await agent.request('session/load', { sessionId, cwd: workspace, mcpServers });
      expect(await agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Continue with the same ontology.' }] })).toMatchObject({ stopReason: 'end_turn' });
      expect(requests).toHaveLength(3);
      expect(requests[2].messages.flatMap((message: any) => message.tool_calls || []).map((call: any) => call.function.name)).toContain(selectedTool);
    } finally {
      await agent.close();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60000
);
