/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Typed client for the ManagedAgent gRPC service exposed by nexusd on the gRPC port (default 2028).
 * Wraps the Rust napi addon (`nexus-napi`) with typed request/response shapes.
 */

// Lazy-load the native addon. In both dev and packaged mode, resolve
// from the app root (app.getAppPath()) so the path survives bundling.
function loadNativeBinding(): typeof import('../../../native/nexus-napi') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    const path = require('path');
    const appRoot = app.isPackaged
      ? app.getAppPath().replace('app.asar', 'app.asar.unpacked')
      : app.getAppPath();
    return require(path.join(appRoot, 'native', 'nexus-napi'));
  } catch {
    throw new Error('nexus-napi native module not available. Run `bun run build:native` first.');
  }
}

export interface StartSessionParams {
  agentId: string;
  repos: string[];
  model: string;
  ownerId?: string;
  zoneId?: string;
}

export interface StartSessionResult {
  sessionId: string;
  workspacePath: string;
}

export interface CancelSessionParams {
  sessionId: string;
  mode: 'graceful' | 'force';
}

export interface CancelSessionResult {
  cancelled: boolean;
}

export interface GetSessionParams {
  sessionId: string;
}

export interface GetSessionResult {
  sessionId: string;
  agentId: string;
  workspacePath: string;
  model: string;
  state: string;
}

export class ManagedAgentClient {
  private client: InstanceType<ReturnType<typeof loadNativeBinding>['NexusGrpcClient']>;
  private authToken: string;

  constructor(endpoint: string, authToken = '') {
    const { NexusGrpcClient } = loadNativeBinding();
    this.client = new NexusGrpcClient(endpoint);
    this.authToken = authToken;
  }

  private rpc<T>(method: string, params: Record<string, unknown>): T {
    const raw = this.client.call(method, JSON.stringify(params), this.authToken);
    return JSON.parse(raw) as T;
  }

  startSession(params: StartSessionParams): StartSessionResult {
    return this.rpc<StartSessionResult>('managed_agent.start_session_v1', {
      agent_id: params.agentId,
      repos: params.repos,
      model: params.model,
      owner_id: params.ownerId,
      zone_id: params.zoneId,
    });
  }

  cancelSession(params: CancelSessionParams): CancelSessionResult {
    return this.rpc<CancelSessionResult>('managed_agent.cancel_v1', {
      session_id: params.sessionId,
      mode: params.mode,
    });
  }

  getSession(params: GetSessionParams): GetSessionResult {
    return this.rpc<GetSessionResult>('managed_agent.get_session_v1', {
      session_id: params.sessionId,
    });
  }
}
