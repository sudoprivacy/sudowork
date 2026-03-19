/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenClaw Config Reader
 *
 * Reads OpenClaw configuration from ~/.openclaw/openclaw.json
 * to get gateway auth settings.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Config file paths
const DEFAULT_STATE_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_FILENAME = 'openclaw.json';
const LEGACY_CONFIG_FILENAMES = ['clawdbot.json', 'moltbot.json', 'moldbot.json'];

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
 * Resolve the state directory (default: ~/.openclaw)
 */
function resolveStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) {
    return resolveUserPath(override);
  }

  const newDir = DEFAULT_STATE_DIR;
  const legacyDirs = ['.clawdbot', '.moltbot', '.moldbot'].map((dir) => path.join(os.homedir(), dir));

  if (fs.existsSync(newDir)) {
    return newDir;
  }

  const existingLegacy = legacyDirs.find((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });

  if (existingLegacy) {
    return existingLegacy;
  }

  return newDir;
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
 * Find the config file path
 */
function findConfigPath(): string | null {
  const override = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (override) {
    return resolveUserPath(override);
  }

  const stateDir = resolveStateDir();
  const candidates = [CONFIG_FILENAME, ...LEGACY_CONFIG_FILENAMES].map((name) => path.join(stateDir, name));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Read OpenClaw config from a specific state directory (e.g. ~/.sudoclaw)
 */
export function readOpenClawConfigFromDir(stateDir: string): OpenClawConfig | null {
  const configPath = path.join(path.resolve(stateDir.replace(/^~/, os.homedir())), CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return null;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    try {
      return JSON.parse(content) as OpenClawConfig;
    } catch {
      const cleanContent = content.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) => (match.startsWith('"') ? match : match.startsWith('/*') ? '' : ''));
      return JSON.parse(cleanContent) as OpenClawConfig;
    }
  } catch {
    return null;
  }
}

/**
 * Read OpenClaw config from file
 */
export function readOpenClawConfig(): OpenClawConfig | null {
  const configPath = findConfigPath();
  if (!configPath) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    try {
      return JSON.parse(content) as OpenClawConfig;
    } catch {
      // If standard parse fails, try removing comments (JSONC style)
      // Use a string-aware approach: skip // and /* */ only outside quoted strings
      const cleanContent = content.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) => (match.startsWith('"') ? match : match.startsWith('/*') ? '' : ''));
      return JSON.parse(cleanContent) as OpenClawConfig;
    }
  } catch (error) {
    console.warn('[OpenClawConfig] Failed to read config:', error);
    return null;
  }
}

/**
 * Get gateway auth settings from config
 */
export function getGatewayAuthFromConfig(): OpenClawGatewayAuth | null {
  const config = readOpenClawConfig();
  return config?.gateway?.auth ?? null;
}

/**
 * Get gateway auth token from config
 */
export function getGatewayAuthToken(): string | null {
  const auth = getGatewayAuthFromConfig();
  if (auth?.mode === 'token' && auth.token) {
    return auth.token;
  }
  return null;
}

/**
 * Get gateway auth password from config
 */
export function getGatewayAuthPassword(): string | null {
  const auth = getGatewayAuthFromConfig();
  if (auth?.mode === 'password' && auth.password) {
    return auth.password;
  }
  return null;
}

/** Default port for system OpenClaw (~/.openclaw) */
const SYSTEM_OPENCLAW_DEFAULT_PORT = 18789;

/** Default port for Sudoclaw (~/.sudoclaw) — avoids conflict with system OpenClaw (18789) */
export const SUDOCLAW_DEFAULT_PORT = 18799;

/**
 * Get gateway port from config (optionally from a specific state dir)
 * When stateDir is provided (Sudoclaw), defaults to 18799 to avoid conflict with system OpenClaw (18789).
 */
export function getGatewayPort(stateDir?: string): number {
  const config = stateDir ? readOpenClawConfigFromDir(stateDir) : readOpenClawConfig();
  const port = config?.gateway?.port;
  if (typeof port === 'number' && Number.isFinite(port) && port > 0) {
    return port;
  }
  return stateDir ? SUDOCLAW_DEFAULT_PORT : SYSTEM_OPENCLAW_DEFAULT_PORT;
}
