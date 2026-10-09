/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure sudoclaw-config value types — the shape the IPC bridge and renderer read
 * for the sudoclaw gateway config/status, kept separate from the IPC bridge
 * runtime so consumers reference the types without it.
 */

// Sudoclaw config (~/.nexus/sudoclaw) / Sudoclaw 配置
// Matches sudoclaw.json schema: models.providers, agents.defaults, etc.
export type SudoclawProviderModel = { id: string; name?: string; input?: string[] };
export type SudoclawProvider = {
  baseUrl?: string;
  apiKey?: string;
  api?: string; // e.g. openai, anthropic, google-generative-ai
  models?: SudoclawProviderModel[];
};
export type SudoclawConfig = {
  lastRunMode?: string;
  agents?: { defaults?: { model?: { primary?: string; fallbacks?: string[] }; imageModel?: string; imageAnalysisModel?: string; imageGenerationModel?: string; models?: Record<string, { alias?: string }> } };
  models?: {
    mode?: 'merge' | 'replace';
    providers?: Record<string, SudoclawProvider>;
  };
  env?: { vars?: Record<string, string> };
  plugins?: { entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }> };
};

export type SudoclawTestGatewayResult = {
  success: boolean;
  port?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
};

export interface ISudoclawStatus {
  installed: boolean;
  configPath: string;
  gatewayRunning?: boolean;
  gatewayPort?: number;
  gatewayHost?: string;
  gatewayUrl?: string;
  isConnected?: boolean;
  hasActiveSession?: boolean;
  sessionKey?: string | null;
  workspace?: string;
  agentName?: string;
  model?: string;
  cliPath?: string;
  version?: string;
  error?: string;
}
