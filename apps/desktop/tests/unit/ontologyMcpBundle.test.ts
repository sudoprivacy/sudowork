import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const bundlePath = path.resolve(__dirname, '../../resources/ontology-mcp/index.js');
const temporaryDirectories: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
});

describe('ontology MCP bundle', () => {
  it('serves the selected published ontology version over stdio', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-ontology-mcp-'));
    temporaryDirectories.push(directory);
    const exportPath = path.join(directory, 'ontology.json');
    await fs.writeFile(
      exportPath,
      JSON.stringify({
        workspaceId: 'crm',
        title: 'CRM',
        description: 'Customer ontology',
        updatedAt: Date.now(),
        versions: [
          {
            id: 'version-1',
            version: 'v1',
            status: 'published',
            isActive: true,
            summary: 'Initial CRM ontology',
            snapshot: {
              objects: [
                { id: 'customer', code: 'customer', name: 'Customer', description: 'A customer', attributes: [] },
                { id: 'order', code: 'order', name: 'Order', description: 'An order', attributes: [] },
              ],
              relations: [
                {
                  id: 'customer-orders',
                  code: 'customer_orders',
                  name: 'Customer Orders',
                  fromObjectId: 'customer',
                  toObjectId: 'order',
                  dataBinding: { mode: 'direct', joinKeys: [{ fromAttributeId: 'customer-id', toAttributeId: 'order-customer-id' }] },
                },
              ],
              mappings: [],
              qualityRules: [],
              logicFunctions: [{ id: 'lookup', code: 'customer_lookup', name: 'Customer Lookup', status: 'active', parameters: [{ name: 'query', type: 'object', required: true }] }],
              actions: [{ id: 'notify', code: 'notify_customer', name: 'Notify Customer', status: 'active', executor: 'notification', parameters: [{ name: 'recordId', type: 'string', required: true }] }],
            },
          },
        ],
      })
    );

    const calls: Array<Record<string, unknown>> = [];
    const runtimeServer = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        calls.push(JSON.parse(body) as Record<string, unknown>);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, data: { execution: { output: [{ id: 'customer-1' }] } } }));
      });
    });
    servers.push(runtimeServer);
    await new Promise<void>((resolve) => runtimeServer.listen(0, '127.0.0.1', resolve));
    const runtimePort = (runtimeServer.address() as AddressInfo).port;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundlePath],
      env: {
        ...process.env,
        ONTOLOGY_EXPORT_FILE: exportPath,
        ONTOLOGY_VERSION_ID: 'version-1',
        ONTOLOGY_RUNTIME_BASE_URL: `http://127.0.0.1:${runtimePort}`,
        ONTOLOGY_RUNTIME_TOKEN: 'runtime-token',
        ONTOLOGY_WORKSPACE_ID: 'crm',
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'ontology-mcp-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(['ontology_get_overview', 'ontology_search', 'ontology_get_object', 'ontology_list_logic', 'ontology_list_relations', 'ontology_list_actions', 'logic_customer_lookup', 'action_notify_customer', 'relation_customer_orders']);

      const result = await client.callTool({ name: 'ontology_get_object', arguments: { id_or_code: 'customer' } });
      expect(JSON.stringify(result.content)).toContain('Customer');
      const executed = await client.callTool({ name: 'logic_customer_lookup', arguments: { query: { id: 'customer-1' } } });
      expect(JSON.stringify(executed.content)).toContain('customer-1');
      await client.callTool({ name: 'action_notify_customer', arguments: { recordId: 'customer-1' } });
      await client.callTool({ name: 'relation_customer_orders', arguments: { query: { id: 'customer-1' } } });
      expect(calls).toEqual([
        {
          workspaceId: 'crm',
          input: { id: 'lookup', versionId: 'version-1', arguments: { query: { id: 'customer-1' } } },
        },
        {
          workspaceId: 'crm',
          input: { id: 'notify', versionId: 'version-1', arguments: { recordId: 'customer-1' } },
        },
        {
          workspaceId: 'crm',
          input: { id: 'customer-orders', versionId: 'version-1', arguments: { query: { id: 'customer-1' } } },
        },
      ]);
    } finally {
      await client.close();
    }
  });
});
