import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { IMcpServer } from '@sudowork/common/storageTypes';
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { ScodeMcpAgent } from '@process/services/mcpServices/agents/ScodeMcpAgent';

function getOntologyMcpScriptPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ontology-mcp', 'index.js');
  return path.join(app.getAppPath(), 'resources', 'ontology-mcp', 'index.js');
}

export function ontologyMcpServerName(blueprintId: string): string {
  return `ontology-${blueprintId}`;
}

export async function installOntologyMcpServer(input: IOntologyMcpRegistrationInput): Promise<void> {
  const scriptPath = getOntologyMcpScriptPath();
  if (!existsSync(scriptPath)) throw new Error('Ontology MCP server bundle is unavailable. Rebuild the desktop resources and try again.');
  const nodePath = getNodeBinaryPath();
  if (!existsSync(nodePath)) throw new Error('Sudowork Node runtime is unavailable.');
  const now = Date.now();
  const server: IMcpServer = {
    id: ontologyMcpServerName(input.blueprintId),
    name: ontologyMcpServerName(input.blueprintId),
    description: `Read-only tools for ontology ${input.workspaceId} version ${input.versionId}.`,
    enabled: true,
    status: 'disconnected',
    transport: {
      type: 'stdio',
      command: nodePath,
      args: [scriptPath],
      env: {
        ONTOLOGY_EXPORT_FILE: input.exportFile,
        ONTOLOGY_VERSION_ID: input.versionId,
      },
    },
    createdAt: now,
    updatedAt: now,
    originalJson: '',
  };
  const result = await new ScodeMcpAgent().installMcpServers([server]);
  if (!result.success) throw new Error(result.error || 'Failed to register ontology MCP tools with Sudocode.');
}

export async function removeOntologyMcpServer(blueprintId: string): Promise<void> {
  const result = await new ScodeMcpAgent().removeMcpServer(ontologyMcpServerName(blueprintId));
  if (!result.success) throw new Error(result.error || 'Failed to remove ontology MCP tools from Sudocode.');
}

interface IOntologyMcpRegistrationInput {
  blueprintId: string;
  workspaceId: string;
  versionId: string;
  exportFile: string;
}
