/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Nexus AgentRegistry client.
 *
 * Registers ACP-spawned agents (e.g. sudo-code) with the local nexusd
 * AgentRegistry before the process is launched. nexusd creates /agents/{id}/
 * in its VFS and returns the per-agent API key and IPC inbox path.
 *
 * Nexus runs with --auth-type none in the sudowork profile, so no Bearer
 * token is required for the admin-scoped registration endpoint.
 */

import { resolveConfig } from './config.js';

const NEXUS_DEFAULT_URL = 'http://localhost:12012';

export interface NexusAgentRegistration {
  agent_id: string;
  api_key: string;
  workspace: string;
  ipc_inbox: string | null;
}

/**
 * Register an ACP agent with the local nexusd AgentRegistry.
 *
 * Returns the registration result on success, or null if nexusd is not
 * reachable (dev / standalone mode). The caller should proceed even when
 * null is returned — nexus integration is best-effort.
 */
export async function registerNexusAgent(
  agentId: string,
  name: string,
): Promise<NexusAgentRegistration | null> {
  const config = resolveConfig();
  const baseUrl = config.baseUrl ?? NEXUS_DEFAULT_URL;

  try {
    const response = await fetch(`${baseUrl}/api/v2/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        name,
        grants: [{ path: '/', role: 'contributor' }],
        ipc: true,
      }),
    });

    if (!response.ok) {
      console.warn(`[NexusAgentRegistry] Registration failed: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      agent_id: string;
      api_key: string;
      ipc_inbox: string | null;
    };

    return {
      agent_id: data.agent_id,
      api_key: data.api_key,
      workspace: `/agents/${data.agent_id}/`,
      ipc_inbox: data.ipc_inbox ?? null,
    };
  } catch (err) {
    console.warn(`[NexusAgentRegistry] Registration error (nexusd not running?):`, err);
    return null;
  }
}
