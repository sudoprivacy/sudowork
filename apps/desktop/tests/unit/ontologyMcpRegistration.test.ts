import { beforeEach, describe, expect, it, vi } from 'vitest';

const installMcpServers = vi.fn();
const removeMcpServer = vi.fn();

vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/mock/app' },
}));
vi.mock('@process/services/claudeCli/NodeRuntimeService', () => ({
  getNodeBinaryPath: () => '/mock/node',
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

  it('registers a version-pinned read-only server with Sudocode', async () => {
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
});
