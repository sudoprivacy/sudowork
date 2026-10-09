import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { expect, it } from 'vitest';
import { findScodeSessionFile } from '@process/task/acpUsageReconciliation';
import { repairOntologyToolHistory } from '@process/services/ontology/ontologyToolHistory';
import { ONTOLOGY_RUNTIME_MCP_NAME, ONTOLOGY_TOOL_PREFIX } from '@process/services/ontology/ontologyToolNames';

const binary = process.env.SUDOCODE_TEST_BINARY || path.join(os.homedir(), '.nexus/sudowork/sudocode/scode');

it.skipIf(!existsSync(binary))(
  'round-trips ontology tools and restored history through real Sudocode and a local model endpoint',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ontology-agent-roundtrip-'));
    const workspace = path.join(root, 'workspace');
    const config = path.join(root, 'config');
    await fs.mkdir(workspace);
    await fs.mkdir(config);
    const exportFile = path.join(root, 'published.json');
    await fs.writeFile(
      exportFile,
      JSON.stringify({
        workspaceId: 'northwind',
        title: 'Northwind',
        versions: [{ id: 'v3', version: 'v3', status: 'published', snapshot: { objects: [], relations: [], mappings: [], qualityRules: [], actions: [], logicFunctions: [{ id: 'lookup', code: 'product_lookup', name: 'Products', status: 'active', parameters: [] }] } }],
      })
    );
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
      const toolName = `${ONTOLOGY_TOOL_PREFIX}ontology_list_logic`;
      const isToolCall = requests.length === 1;
      const delta = isToolCall ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-ontology', type: 'function', function: { name: toolName, arguments: '{}' } }] } : { role: 'assistant', content: 'Northwind product_lookup is available.' };
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
    const mcpServers = [
      {
        name: ONTOLOGY_RUNTIME_MCP_NAME,
        command: process.execPath,
        args: [path.resolve(__dirname, '../../resources/ontology-mcp/index.js')],
        env: [
          { name: 'ONTOLOGY_EXPORT_FILE', value: exportFile },
          { name: 'ONTOLOGY_VERSION_ID', value: 'v3' },
        ],
      },
    ];

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
      expect(requests[1].messages.some((message: any) => message.role === 'tool' && JSON.stringify(message).includes('product_lookup'))).toBe(true);
      await agent.close();
      const transcript = (await findScodeSessionFile(workspace, sessionId))!;
      const blueprint = 'cabd46a93f34fbd80278da616e504bf5';
      const oldName = `mcp__ontology-${blueprint}__ontology_list_logic`;
      await fs.writeFile(transcript, (await fs.readFile(transcript, 'utf8')).replaceAll(`${ONTOLOGY_TOOL_PREFIX}ontology_list_logic`, oldName));
      expect(await repairOntologyToolHistory({ workspace, acpSessionId: sessionId }, blueprint, { ontology_list_logic: 'ontology_list_logic' })).toBeGreaterThan(0);
      agent = start();
      await agent.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
      await agent.request('session/load', { sessionId, cwd: workspace, mcpServers });
      expect(await agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Continue with the same ontology.' }] })).toMatchObject({ stopReason: 'end_turn' });
      expect(requests).toHaveLength(3);
      expect(requests[2].messages.flatMap((message: any) => message.tool_calls || []).map((call: any) => call.function.name)).toContain(`${ONTOLOGY_TOOL_PREFIX}ontology_list_logic`);
    } finally {
      await agent.close();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  60000
);
