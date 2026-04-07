/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Hook File Operations
 *
 * Nexus is the SINGLE SOURCE OF TRUTH for all state.
 *
 * State file: /safe/config/enabled
 * Event files: /safe/event/{uuid}
 * Action files: /safe/action/{uuid}
 */

import type { Nexus } from '@/common/nexus';
import { getNexusRpcClient } from '@/common/nexus';
import type { SafetyStatus, EventFileData, ActionFileData, RiskLevel, NetworkEventData, FileEventData, ProcessEventData } from '@/common/safetyTypes';
import { mainLog, mainError } from '@process/utils/mainLogger';

/** Nexus security hook directory paths */
export const EVENT_DIR = '/safe/event';
export const ACTION_DIR = '/safe/action';
export const CONFIG_DIR = '/safe/config';
export const ENABLED_CONFIG_PATH = '/safe/config/enabled';

/** Default state for first run */
export const DEFAULT_ENABLED_STATE = {
  enabled: true,
  fastPass: false,
};

/**
 * Get Nexus RPC client instance
 */
export function getNexusClient(): Nexus {
  return getNexusRpcClient();
}

/**
 * Read a Nexus file as UTF-8, normalizing RPC shapes (Buffer vs `{ content }`).
 */
export async function readNexusFileAsUtf8(filePath: string): Promise<string | null> {
  try {
    const client = getNexusClient();
    const result = await client.read(filePath, false);

    if (Buffer.isBuffer(result)) {
      const s = result.toString('utf-8');
      return s.length > 0 ? s : null;
    }

    if (result && typeof result === 'object' && 'content' in result) {
      const raw = (result as { content?: unknown }).content;
      if (Buffer.isBuffer(raw)) {
        const s = raw.toString('utf-8');
        return s.length > 0 ? s : null;
      }
      if (typeof raw === 'string') {
        return raw.length > 0 ? raw : null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Ensure security hook directories exist (create via Nexus RPC)
 */
export async function ensureSecurityHookDirs(): Promise<void> {
  try {
    const client = getNexusClient();
    await client.mkdir(EVENT_DIR, true);
    await client.mkdir(ACTION_DIR, true);
    await client.mkdir(CONFIG_DIR, true);
  } catch {
    // Directories may already exist, ignore errors
  }
}

// ============================================================================
// State Management - Nexus is the SINGLE SOURCE OF TRUTH
// ============================================================================

/**
 * Read enabled state from Nexus filesystem
 * Returns null if state file doesn't exist or Nexus is unavailable
 */
export async function readEnabledState(): Promise<{ enabled: boolean; fastPass: boolean } | null> {
  try {
    const client = getNexusClient();
    const result = await client.read(ENABLED_CONFIG_PATH, false);

    if (Buffer.isBuffer(result)) {
      const data = JSON.parse(result.toString('utf-8'));
      return {
        enabled: data.enabled === true,
        fastPass: data.fastPass === true,
      };
    }

    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      const data = Buffer.isBuffer(content)
        ? JSON.parse(content.toString('utf-8'))
        : JSON.parse(String(content));
      return {
        enabled: data.enabled === true,
        fastPass: data.fastPass === true,
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Write enabled state to Nexus filesystem
 */
export async function writeEnabledState(enabled: boolean, fastPass: boolean = false): Promise<void> {
  try {
    const client = getNexusClient();
    await client.write(ENABLED_CONFIG_PATH, JSON.stringify({
      enabled,
      fastPass,
      timestamp: Date.now(),
    }));
    mainLog('SecurityHook', `Wrote state: enabled=${enabled}, fastPass=${fastPass}`);
  } catch (error) {
    mainError('SecurityHook', 'Failed to write state:', error);
    throw error;
  }
}

/**
 * Initialize state if not exists
 * Returns the current state (existing or newly created)
 */
export async function ensureEnabledState(): Promise<{ enabled: boolean; fastPass: boolean }> {
  const existingState = await readEnabledState();
  if (existingState !== null) {
    mainLog('SecurityHook', `Existing state: enabled=${existingState.enabled}, fastPass=${existingState.fastPass}`);
    return existingState;
  }

  mainLog('SecurityHook', `No existing state, initializing with default: enabled=${DEFAULT_ENABLED_STATE.enabled}`);
  await writeEnabledState(DEFAULT_ENABLED_STATE.enabled, DEFAULT_ENABLED_STATE.fastPass);
  return { ...DEFAULT_ENABLED_STATE };
}

// ============================================================================
// Event/Action File Operations
// ============================================================================

/**
 * List all event filenames in event directory via Nexus RPC
 */
export async function listEventFilenames(): Promise<string[]> {
  try {
    const client = getNexusClient();
    const items = await client.list(EVENT_DIR);
    return items.map((item) => {
      const name = item.name || '';
      const path = item.path || '';
      if (name && !name.includes('/')) {
        return name;
      }
      return (path || name).split('/').pop() || name;
    });
  } catch (error) {
    mainError('SecurityHook', 'Failed to list event filenames:', error);
    return [];
  }
}

/**
 * Read and parse an event file via Nexus RPC
 */
export async function readEventFile(eventUuidOrPath: string): Promise<EventFileData | null> {
  try {
    const client = getNexusClient();
    const filePath = eventUuidOrPath.startsWith('/') ? eventUuidOrPath : `${EVENT_DIR}/${eventUuidOrPath}`;

    const result = await client.read(filePath, false);

    if (Buffer.isBuffer(result)) {
      return JSON.parse(result.toString('utf-8')) as EventFileData;
    }

    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      if (Buffer.isBuffer(content)) {
        return JSON.parse(content.toString('utf-8')) as EventFileData;
      }
      return JSON.parse(String(content)) as EventFileData;
    }

    return null;
  } catch (error) {
    mainError('SecurityHook', 'Failed to read event file:', error);
    return null;
  }
}

/**
 * Write action file to action directory via Nexus RPC
 */
export async function writeActionFile(eventUuid: string, data: ActionFileData): Promise<boolean> {
  try {
    const filePath = `${ACTION_DIR}/${eventUuid}`;
    const client = getNexusClient();
    await client.write(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    mainError('SecurityHook', 'Failed to write action file:', error);
    return false;
  }
}

/**
 * Delete an event file via Nexus RPC
 */
export async function deleteEventFile(eventUuid: string): Promise<boolean> {
  try {
    const filePath = `${EVENT_DIR}/${eventUuid}`;
    const client = getNexusClient();
    await client.delete(filePath);
    return true;
  } catch (error) {
    mainError('SecurityHook', 'Failed to delete event file:', error);
    return false;
  }
}

/**
 * Check if action file exists for given event UUID
 */
export async function actionExists(eventUuid: string): Promise<boolean> {
  try {
    const client = getNexusClient();
    return await client.exists(`${ACTION_DIR}/${eventUuid}`);
  } catch (error) {
    return false;
  }
}

/**
 * Convert event file data to SafetyStatus
 */
export function eventToSafetyStatus(eventUuid: string, data: EventFileData): SafetyStatus {
  let level: RiskLevel = 'medium';
  let code = 'UNKNOWN_EVENT';
  let message = 'Unknown event detected';

  if (data.type === 'network') {
    const networkData = data.data as NetworkEventData;
    code = `NETWORK_${networkData.method}`;
    message = `Network request: ${networkData.method} ${networkData.url}`;
    level = 'low';
  } else if (data.type === 'file') {
    const fileData = data.data as FileEventData;
    const flags = fileData.flags || [];

    if (flags.includes('O_WRONLY') || flags.includes('O_RDWR')) {
      if (flags.includes('O_TRUNC')) {
        level = 'high';
        code = 'FILE_TRUNCATE_WRITE';
        message = `File truncate write: ${fileData.path}`;
      } else if (flags.includes('O_CREAT')) {
        level = 'medium';
        code = 'FILE_CREATE';
        message = `File create: ${fileData.path}`;
      } else {
        level = 'medium';
        code = 'FILE_WRITE';
        message = `File write: ${fileData.path}`;
      }
    } else if (flags.includes('O_RDONLY')) {
      level = 'low';
      code = 'FILE_READ';
      message = `File read: ${fileData.path}`;
    } else {
      code = 'FILE_UNKNOWN';
      message = `File operation: ${fileData.path}`;
    }
  } else if (data.type === 'process') {
    const processData = data.data as ProcessEventData;
    code = 'PROCESS_EXEC';
    message = `Process execution: ${processData.command}${processData.args.length > 0 ? ' ' + processData.args.join(' ') : ''}`;
    level = 'high';
  }

  return {
    level,
    eventType: data.type,
    eventUuid,
    details: {
      code,
      message,
      detectedAt: Date.now(),
      networkData: data.type === 'network' ? (data.data as NetworkEventData) : undefined,
      fileData: data.type === 'file' ? (data.data as FileEventData) : undefined,
      processData: data.type === 'process' ? (data.data as ProcessEventData) : undefined,
    },
  };
}