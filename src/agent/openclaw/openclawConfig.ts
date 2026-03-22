/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenClaw Config Reader for Sudoclaw
 *
 * Reads OpenClaw configuration ONLY from the specified Sudoclaw directory (~/.nexus/.sudoclaw).
 * NEVER reads from system OpenClaw (~/.openclaw) to ensure complete isolation.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_FILENAME = 'openclaw.json';

interface OpenClawGatewayAuth {
  mode?: 'none' | 'token' | 'password';
  token?: string;
  password?: string;
}

interface OpenClawGatewayConfig {
  port?: number;
  auth?: OpenClawGatewayAuth;
}

interface OpenClawConfig {
  gateway?: OpenClawGatewayConfig;
}

/**
 * Resolve user path (expand ~ to home directory)
 */
function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith('~')) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

/**
 * Read OpenClaw config from a specific state directory (e.g. ~/.nexus/.sudoclaw)
 * This is the ONLY config reader for Sudoclaw - ensures complete isolation from system OpenClaw.
 */
export function readOpenClawConfigFromDir(stateDir: string): OpenClawConfig | null {
  const configPath = path.join(path.resolve(stateDir.replace(/^~/, os.homedir())), CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return null;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    try {
      return JSON.parse(content) as OpenClawConfig;
    } catch {
      // If standard parse fails, try removing comments (JSONC style)
      const cleanContent = content.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) => (match.startsWith('"') ? match : match.startsWith('/*') ? '' : ''));
      return JSON.parse(cleanContent) as OpenClawConfig;
    }
  } catch {
    return null;
  }
}

/**
 * Get gateway auth settings from config in the specified directory
 * @param stateDir - The state directory to read config from (required for Sudoclaw)
 */
export function getGatewayAuthFromConfig(stateDir: string): OpenClawGatewayAuth | null {
  const config = readOpenClawConfigFromDir(stateDir);
  return config?.gateway?.auth ?? null;
}

/**
 * Get gateway auth token from config in the specified directory
 * @param stateDir - The state directory to read config from (required for Sudoclaw)
 */
export function getGatewayAuthToken(stateDir: string): string | null {
  const auth = getGatewayAuthFromConfig(stateDir);
  if (auth?.mode === 'token' && auth.token) {
    return auth.token;
  }
  return null;
}

/**
 * Get gateway auth password from config in the specified directory
 * @param stateDir - The state directory to read config from (required for Sudoclaw)
 */
export function getGatewayAuthPassword(stateDir: string): string | null {
  const auth = getGatewayAuthFromConfig(stateDir);
  if (auth?.mode === 'password' && auth.password) {
    return auth.password;
  }
  return null;
}

/** Default port for Sudoclaw (~/.nexus/.sudoclaw) — isolated from system OpenClaw (18789) */
export const SUDOCLAW_DEFAULT_PORT = 17863;

/**
 * Get gateway port from config in the specified directory
 * Always uses SUDOCLAW_DEFAULT_PORT (17863) to avoid conflict with system OpenClaw (18789)
 * @param stateDir - The state directory to read config from (required for Sudoclaw)
 */
export function getGatewayPort(stateDir: string): number {
  const config = readOpenClawConfigFromDir(stateDir);
  const port = config?.gateway?.port;
  if (typeof port === 'number' && Number.isFinite(port) && port > 0) {
    return port;
  }
  return SUDOCLAW_DEFAULT_PORT;
}
