import { beforeEach, describe, expect, it, vi } from 'vitest';

const installMcpServers = vi.fn();
const removeMcpServer = vi.fn();

vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app',
    getPath: (name: string) => `/mock/${name}`,
  },
  safeStorage: {
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
    isEncryptionAvailable: () => true,
  },
}));
vi.mock('@process/services/claudeCli/NodeRuntimeService', () => ({
  getNodeBinaryPath: () => '/mock/node',
}));
// Break the heavy import chain that OntologyWriteBridge → ontologyService pulls in.
// The tests only care about the MCP install call, not the write endpoint.
vi.mock('@process/services/ontology/OntologyWriteBridge', () => ({
  ensureOntologyWriteBridge: async () => ({ port: 45678, token: 'test-token' }),
}));
vi.mock('@process/services/mcpServices/agents/ScodeMcpAgent', () => ({
  ScodeMcpAgent: class {
    installMcpServers = installMcpServers;
    removeMcpServer = removeMcpServer;
  },
}));

describe('OntologyMcpRegistration', () => {
  beforeEach(() => {
    installMcpServers.mockReset().mockResolvedValue({ success: true });
    removeMcpServer.mockReset().mockResolvedValue({ success: true });
  });

  it('registers a version-pinned runtime server with Sudocode', async () => {
    const { installOntologyMcpServer } = await import('@process/services/ontology/OntologyMcpRegistration');
    await installOntologyMcpServer({
      blueprintId: 'blueprint-1',
      workspaceId: 'crm',
      versionId: 'version-1',
      exportFile: '/data/ontology/mcp-crm.json',
    });

    expect(installMcpServers).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'ontology-blueprint-1',
        enabled: true,
        transport: expect.objectContaining({
          type: 'stdio',
          command: '/mock/node',
          args: ['/mock/app/resources/ontology-mcp/index.js'],
          env: {
            ONTOLOGY_EXPORT_FILE: '/data/ontology/mcp-crm.json',
            ONTOLOGY_VERSION_ID: 'version-1',
            ONTOLOGY_RUNTIME_BASE_URL: 'http://127.0.0.1:45678',
            ONTOLOGY_RUNTIME_TOKEN: 'test-token',
            ONTOLOGY_WORKSPACE_ID: 'crm',
          },
        }),
      }),
    ]);
  });

  it('removes the matching Sudocode server', async () => {
    const { removeOntologyMcpServer } = await import('@process/services/ontology/OntologyMcpRegistration');
    await removeOntologyMcpServer('blueprint-1');
    expect(removeMcpServer).toHaveBeenCalledWith('ontology-blueprint-1');
  });

  it('registers the write-capable builder MCP with a bridge URL + token', async () => {
    const { ensureOntologyBuilderMcpServer } = await import('@process/services/ontology/OntologyMcpRegistration');
    const config = await ensureOntologyBuilderMcpServer();
    expect(installMcpServers).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'ontology-builder',
        enabled: true,
        transport: expect.objectContaining({
          type: 'stdio',
          command: '/mock/node',
          args: ['/mock/app/resources/ontology-builder-mcp/index.js'],
          env: {
            ONTOLOGY_WRITE_BASE_URL: 'http://127.0.0.1:45678',
            ONTOLOGY_WRITE_TOKEN: 'test-token',
          },
        }),
      }),
    ]);
    // The returned config is what the AI Builder page injects into
    // conversation.create's extra.extraMcpConfigs, so pin its exact shape.
    expect(config).toEqual({
      name: 'ontology-builder',
      command: '/mock/node',
      args: ['/mock/app/resources/ontology-builder-mcp/index.js'],
      env: [
        { name: 'ONTOLOGY_WRITE_BASE_URL', value: 'http://127.0.0.1:45678' },
        { name: 'ONTOLOGY_WRITE_TOKEN', value: 'test-token' },
      ],
    });
  });
});
