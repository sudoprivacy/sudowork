/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { isAcpBackendRuntimeEnabled } from '../../../types/acpTypes';
import type { AcpBackend } from '../../../types/acpTypes';
import type { IMcpServer } from '../../../common/storage';
import { CodebuddyMcpAgent } from './agents/CodebuddyMcpAgent';
import { QwenMcpAgent } from './agents/QwenMcpAgent';
import { IflowMcpAgent } from './agents/IflowMcpAgent';
import { CodexMcpAgent } from './agents/CodexMcpAgent';
import { ScodeMcpAgent } from './agents/ScodeMcpAgent';
import type { IMcpProtocol, DetectedMcpServer, McpConnectionTestResult, McpSyncResult, McpSource } from './McpProtocol';

export class McpService {
  private agents: Map<McpSource, IMcpProtocol>;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.agents = new Map([
      ['scode', new ScodeMcpAgent()],
      ['codebuddy', new CodebuddyMcpAgent()],
      ['qwen', new QwenMcpAgent()],
      ['iflow', new IflowMcpAgent()],
      ['codex', new CodexMcpAgent()],
    ]);
  }

  private withServiceLock<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.operationQueue.then(operation, () => operation());
    this.operationQueue = queued.catch(() => {});
    return queued;
  }

  private getAgentForConfig(agent: { backend: AcpBackend; cliPath?: string }): IMcpProtocol | undefined {
    if (!isAcpBackendRuntimeEnabled(agent.backend)) {
      throw new Error(`ACP backend ${agent.backend} is disabled`);
    }
    return this.agents.get(agent.backend);
  }

  getAgentMcpConfigs(agents: Array<{ backend: AcpBackend; name: string; cliPath?: string }>): Promise<DetectedMcpServer[]> {
    for (const agent of agents) {
      if (!isAcpBackendRuntimeEnabled(agent.backend)) {
        return Promise.reject(new Error(`ACP backend ${agent.backend} is disabled`));
      }
    }

    return this.withServiceLock(async () => {
      const results = await Promise.all(
        agents.map(async (agent) => {
          try {
            const agentInstance = this.getAgentForConfig(agent);
            if (!agentInstance) {
              mainWarn('McpService', `No agent instance for backend: ${agent.backend}`);
              return null;
            }

            const servers = await agentInstance.detectMcpServers(agent.cliPath);
            mainLog('McpService', `Detected ${servers.length} MCP servers for ${agent.backend} (cliPath: ${agent.cliPath || 'default'})`);
            return servers.length > 0 ? { source: agent.backend as McpSource, servers } : null;
          } catch (error) {
            mainWarn('McpService', `Failed to detect MCP servers for ${agent.backend}:`, error);
            return null;
          }
        })
      );
      return results.filter((result): result is DetectedMcpServer => result !== null);
    });
  }

  getSupportedTransportsForAgent(agent: { backend: string; cliPath?: string }): string[] {
    const agentInstance = this.getAgentForConfig(agent as { backend: AcpBackend; cliPath?: string });
    return agentInstance ? agentInstance.getSupportedTransports() : [];
  }

  async testMcpConnection(server: IMcpServer): Promise<McpConnectionTestResult> {
    const firstAgent = this.agents.values().next().value;
    return firstAgent ? await firstAgent.testMcpConnection(server) : { success: false, error: 'No agent available for connection testing' };
  }

  syncMcpToAgents(mcpServers: IMcpServer[], agents: Array<{ backend: AcpBackend; name: string; cliPath?: string }>): Promise<McpSyncResult> {
    const disabledAgent = agents.find((agent) => !isAcpBackendRuntimeEnabled(agent.backend));
    if (disabledAgent) {
      const error = `ACP backend ${disabledAgent.backend} is disabled`;
      return Promise.resolve({ success: false, results: [{ agent: disabledAgent.name, success: false, error }] });
    }

    const enabledServers = mcpServers.filter((server) => server.enabled);
    if (enabledServers.length === 0) return Promise.resolve({ success: true, results: [] });

    return this.withServiceLock(async () => {
      const results = await Promise.all(
        agents.map(async (agent) => {
          try {
            const agentInstance = this.getAgentForConfig(agent);
            if (!agentInstance) {
              mainWarn('McpService', `Skipping MCP sync for unsupported backend: ${agent.backend}`);
              return { agent: agent.name, success: true };
            }
            const result = await agentInstance.installMcpServers(enabledServers);
            return { agent: agent.name, success: result.success, error: result.error };
          } catch (error) {
            return { agent: agent.name, success: false, error: error instanceof Error ? error.message : String(error) };
          }
        })
      );
      return { success: results.every((result) => result.success), results };
    });
  }

  removeMcpFromAgents(mcpServerName: string, agents: Array<{ backend: AcpBackend; name: string; cliPath?: string }>): Promise<McpSyncResult> {
    return this.withServiceLock(async () => {
      const results = await Promise.all(
        agents.map(async (agent) => {
          try {
            const agentInstance = this.getAgentForConfig(agent);
            if (!agentInstance) {
              mainWarn('McpService', `Skipping MCP removal for unsupported backend: ${agent.backend}`);
              return { agent: `${agent.backend}:${agent.name}`, success: true };
            }
            const result = await agentInstance.removeMcpServer(mcpServerName);
            return { agent: `${agent.backend}:${agent.name}`, success: result.success, error: result.error };
          } catch (error) {
            return { agent: `${agent.backend}:${agent.name}`, success: false, error: error instanceof Error ? error.message : String(error) };
          }
        })
      );
      return { success: results.every((result) => result.success), results };
    });
  }
}

export const mcpService = new McpService();
