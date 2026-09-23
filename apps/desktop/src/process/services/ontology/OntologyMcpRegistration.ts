import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { IMcpServer } from '@sudowork/common/storageTypes';
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { ScodeMcpAgent } from '@process/services/mcpServices/agents/ScodeMcpAgent';
import { ensureOntologyWriteBridge } from './OntologyWriteBridge';

function getOntologyMcpScriptPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ontology-mcp', 'index.js');
  return path.join(app.getAppPath(), 'resources', 'ontology-mcp', 'index.js');
}

function getOntologyBuilderMcpScriptPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ontology-builder-mcp', 'index.js');
  return path.join(app.getAppPath(), 'resources', 'ontology-builder-mcp', 'index.js');
}

export function ontologyMcpServerName(blueprintId: string): string {
  return `ontology-${blueprintId}`;
}

export const ONTOLOGY_BUILDER_MCP_SERVER_NAME = 'ontology-builder';

export async function installOntologyMcpServer(input: IOntologyMcpRegistrationInput): Promise<void> {
  const scriptPath = getOntologyMcpScriptPath();
  if (!existsSync(scriptPath)) throw new Error('Ontology MCP server bundle is unavailable. Rebuild the desktop resources and try again.');
  const nodePath = getNodeBinaryPath();
  if (!existsSync(nodePath)) throw new Error('Sudowork Node runtime is unavailable.');
  const bridge = await ensureOntologyWriteBridge();
  const now = Date.now();
  const server: IMcpServer = {
    id: ontologyMcpServerName(input.blueprintId),
    name: ontologyMcpServerName(input.blueprintId),
    description: `Ontology query, logic, and action tools for ${input.workspaceId} version ${input.versionId}.`,
    enabled: true,
    status: 'disconnected',
    transport: {
      type: 'stdio',
      command: nodePath,
      args: [scriptPath],
      env: {
        ONTOLOGY_EXPORT_FILE: input.exportFile,
        ONTOLOGY_VERSION_ID: input.versionId,
        ONTOLOGY_RUNTIME_BASE_URL: `http://127.0.0.1:${bridge.port}`,
        ONTOLOGY_RUNTIME_TOKEN: bridge.token,
        ONTOLOGY_WORKSPACE_ID: input.workspaceId,
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

export interface IOntologyBuilderMcpConfig {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}

/**
 * Install the write-capable builder MCP server so the AI-构建 chat can call
 * `ontology_upsert_object`, `ontology_upsert_attribute`, etc. Idempotent —
 * safe to call before every AI-Builder session start.
 *
 * The MCP bundle talks to the main-process `OntologyWriteBridge` over
 * 127.0.0.1 with a per-launch bearer token, so writes go through the same
 * `ontologyService` methods the manual workbench UI uses.
 *
 * Returns the exact stdio config the caller should inject into
 * `conversation.create`'s `extra.extraMcpConfigs`; scode's acp session/new
 * only exposes MCPs listed in the `mcpServers` array, so passing the config
 * through settings.json alone is not enough.
 */
export async function ensureOntologyBuilderMcpServer(): Promise<IOntologyBuilderMcpConfig> {
  const scriptPath = getOntologyBuilderMcpScriptPath();
  if (!existsSync(scriptPath)) throw new Error('Ontology builder MCP bundle is unavailable. Run `bun run ontology-builder-mcp:build` and retry.');
  const nodePath = getNodeBinaryPath();
  if (!existsSync(nodePath)) throw new Error('Sudowork Node runtime is unavailable.');
  const bridge = await ensureOntologyWriteBridge();
  const now = Date.now();
  const server: IMcpServer = {
    id: ONTOLOGY_BUILDER_MCP_SERVER_NAME,
    name: ONTOLOGY_BUILDER_MCP_SERVER_NAME,
    description: 'Write tools for the ontology AI builder: create/update objects, attributes, relations, mappings, quality rules, logic, actions, publish, register agent.',
    enabled: true,
    status: 'disconnected',
    transport: {
      type: 'stdio',
      command: nodePath,
      args: [scriptPath],
      env: {
        ONTOLOGY_WRITE_BASE_URL: `http://127.0.0.1:${bridge.port}`,
        ONTOLOGY_WRITE_TOKEN: bridge.token,
      },
    },
    createdAt: now,
    updatedAt: now,
    originalJson: '',
  };
  const result = await new ScodeMcpAgent().installMcpServers([server]);
  if (!result.success) throw new Error(result.error || 'Failed to register ontology builder MCP with Sudocode.');
  return {
    name: ONTOLOGY_BUILDER_MCP_SERVER_NAME,
    command: nodePath,
    args: [scriptPath],
    env: [
      { name: 'ONTOLOGY_WRITE_BASE_URL', value: `http://127.0.0.1:${bridge.port}` },
      { name: 'ONTOLOGY_WRITE_TOKEN', value: bridge.token },
    ],
  };
}

interface IOntologyMcpRegistrationInput {
  blueprintId: string;
  workspaceId: string;
  versionId: string;
  exportFile: string;
}
