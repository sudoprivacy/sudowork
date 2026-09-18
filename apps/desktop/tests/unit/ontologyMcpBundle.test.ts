import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const bundlePath = path.resolve(__dirname, '../../resources/ontology-mcp/index.js');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
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
              objects: [{ id: 'customer', code: 'customer', name: 'Customer', description: 'A customer', attributes: [] }],
              relations: [],
              mappings: [],
              qualityRules: [],
              logicFunctions: [{ id: 'lookup', code: 'customer_lookup', name: 'Customer Lookup' }],
              actions: [{ id: 'notify', code: 'notify_customer', name: 'Notify Customer' }],
            },
          },
        ],
      })
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundlePath],
      env: {
        ...process.env,
        ONTOLOGY_EXPORT_FILE: exportPath,
        ONTOLOGY_VERSION_ID: 'version-1',
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'ontology-mcp-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(['ontology_get_overview', 'ontology_search', 'ontology_get_object', 'ontology_list_logic', 'ontology_list_actions']);

      const result = await client.callTool({ name: 'ontology_get_object', arguments: { id_or_code: 'customer' } });
      expect(JSON.stringify(result.content)).toContain('Customer');
    } finally {
      await client.close();
    }
  });
});
