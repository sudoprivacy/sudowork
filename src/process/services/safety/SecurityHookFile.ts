/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Hook Service - Nexus RPC Implementation
 *
 * Communicates via Nexus RPC file system:
 * - Event files: /safe/event/{uuid} (counterparty → Sudowork)
 * - Action files: /safe/action/{uuid} (Sudowork → counterparty)
 */

import type { Nexus } from '@/common/nexus';
import { getNexusRpcClient } from '@/common/nexus';
import type { SafetyStatus, SafetyConfirmationAction, EventFileData, ActionFileData, EventType, RiskLevel, NetworkEventData, FileEventData } from '@/common/safetyTypes';

/** Nexus security hook directory paths */
export const EVENT_DIR = '/safe/event';
export const ACTION_DIR = '/safe/action';
export const CONFIG_DIR = '/safe/config';
export const ENABLED_CONFIG_PATH = '/safe/config/enabled';

/**
 * Get Nexus RPC client instance
 */
export function getNexusClient(): Nexus {
  return getNexusRpcClient();
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

/**
 * Write safety hook enabled state to Nexus filesystem
 * This allows hook.js in Agent CLI processes to detect state changes
 * @param enabled - Whether safety hook is enabled
 * @param fastPass - If true, hook.js will immediately allow all requests without waiting for polling
 */
export async function writeEnabledState(enabled: boolean, fastPass: boolean = false): Promise<void> {
  try {
    const client = getNexusClient();
    await client.write(ENABLED_CONFIG_PATH, JSON.stringify({ enabled, fastPass, timestamp: Date.now() }));
    console.log(`[SecurityHook] Wrote enabled state: ${enabled}${fastPass ? ' (fastPass)' : ''}`);
  } catch (error) {
    console.error('[SecurityHook] Failed to write enabled state:', error);
  }
}

/**
 * Read safety hook enabled state from Nexus filesystem
 */
export async function readEnabledState(): Promise<boolean> {
  try {
    const client = getNexusClient();
    const result = await client.read(ENABLED_CONFIG_PATH, false);

    // Handle Buffer result
    if (Buffer.isBuffer(result)) {
      const data = JSON.parse(result.toString('utf-8'));
      return data.enabled === true;
    }

    // Handle object result with content
    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      const data = Buffer.isBuffer(content) ? JSON.parse(content.toString('utf-8')) : JSON.parse(String(content));
      return data.enabled === true;
    }

    return true; // Default to enabled
  } catch (error) {
    // File may not exist yet, default to enabled
    return true;
  }
}

/**
 * Read and parse an event file via Nexus RPC
 * @param eventUuidOrPath - Event UUID or full path to event file
 */
export async function readEventFile(eventUuidOrPath: string): Promise<EventFileData | null> {
  try {
    const client = getNexusClient();
    // Determine if it's a full path or just a UUID
    const filePath = eventUuidOrPath.startsWith('/') ? eventUuidOrPath : `${EVENT_DIR}/${eventUuidOrPath}`;

    const result = await client.read(filePath, false);

    // Handle Buffer result
    if (Buffer.isBuffer(result)) {
      return JSON.parse(result.toString('utf-8')) as EventFileData;
    }

    // Handle object result with content
    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      if (Buffer.isBuffer(content)) {
        return JSON.parse(content.toString('utf-8')) as EventFileData;
      }
      return JSON.parse(String(content)) as EventFileData;
    }

    return null;
  } catch (error) {
    console.error('[SecurityHook] Failed to read event file:', error);
    return null;
  }
}

/**
 * Write action file to action directory via Nexus RPC
 */
export async function writeActionFile(eventUuid: string, data: ActionFileData): Promise<string | null> {
  try {
    const filePath = `${ACTION_DIR}/${eventUuid}`;
    const client = getNexusClient();
    await client.write(filePath, JSON.stringify(data, null, 2));
    return filePath;
  } catch (error) {
    console.error('[SecurityHook] Failed to write action file:', error);
    return null;
  }
}

/**
 * List all event filenames in event directory via Nexus RPC
 * Returns array of filenames only (no content reading)
 */
export async function listEventFilenames(): Promise<string[]> {
  return listFilenames(EVENT_DIR);
}

/**
 * List all action filenames in action directory via Nexus RPC
 * Returns array of filenames only
 */
export async function listActionFilenames(): Promise<string[]> {
  return listFilenames(ACTION_DIR);
}

/**
 * Generic list filenames helper
 * Returns only the filename (not full path) for each item
 */
async function listFilenames(dirPath: string): Promise<string[]> {
  try {
    const client = getNexusClient();
    const items = await client.list(dirPath);
    return items.map((item) => {
      const name = item.name || '';
      const path = item.path || '';
      // Return just the filename (from name field, extracted from path if needed)
      if (name && !name.includes('/')) {
        return name;
      }
      // If name contains path or is empty, extract from path
      return (path || name).split('/').pop() || name;
    });
  } catch (error) {
    console.error(`[SecurityHook] Failed to list filenames in ${dirPath}:`, error);
    return [];
  }
}

/**
 * List all event files in event directory via Nexus RPC
 * Returns array of { filename, filePath, data }
 * @deprecated Use listEventFilenames() + readEventFile() for minimal API calls
 */
export async function listEventFiles(): Promise<Array<{ filename: string; filePath: string; data: EventFileData | null }>> {
  try {
    const client = getNexusClient();
    const items = await client.list(EVENT_DIR);

    const files: Array<{ filename: string; filePath: string; data: EventFileData | null }> = [];

    for (const item of items) {
      const filePath = `${EVENT_DIR}/${item.name}`;
      const data = await readEventFile(item.name);
      files.push({ filename: item.name, filePath, data });
    }

    return files;
  } catch (error) {
    console.error('[SecurityHook] Failed to list event files:', error);
    return [];
  }
}

/**
 * Delete a processed event file via Nexus RPC
 */
export async function deleteEventFile(eventUuid: string): Promise<boolean> {
  try {
    const filePath = `${EVENT_DIR}/${eventUuid}`;
    const client = getNexusClient();
    await client.delete(filePath);
    return true;
  } catch (error) {
    console.error('[SecurityHook] Failed to delete event file:', error);
    return false;
  }
}

/**
 * Check if a file exists via Nexus RPC
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const client = getNexusClient();
    return await client.exists(filePath);
  } catch (error) {
    console.error('[SecurityHook] Failed to check file existence:', error);
    return false;
  }
}

/**
 * Check if action file exists for given event UUID
 */
export async function actionExists(eventUuid: string): Promise<boolean> {
  const filePath = `${ACTION_DIR}/${eventUuid}`;
  return fileExists(filePath);
}

/**
 * Convert event file data to SafetyStatus
 */
export function eventToSafetyStatus(eventUuid: string, data: EventFileData): SafetyStatus {
  // Determine risk level based on event type and flags
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

    // Determine risk level based on file operation flags
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
    },
  };
}
