/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Blacklist Service
 *
 * Manages blacklist configuration for safety hook service.
 * - Stores blacklist rules in ProcessConfig (file-based storage for main process)
 * - Syncs blacklist to Nexus filesystem for hook access
 */

import { ProcessConfig } from '@/process/initStorage';
import type { BlacklistConfig, BlacklistRule } from '@/common/safetyTypes';
import { DEFAULT_BLACKLIST_CONFIG } from '@/common/safetyTypes';
import { getNexusClient, CONFIG_DIR } from './SecurityHookFile';

/** Path in Nexus filesystem for blacklist config */
export const BLACKLIST_CONFIG_PATH = '/safe/config/blacklist';

/** Storage key for ProcessConfig */
const BLACKLIST_STORAGE_KEY = 'safetyHook.blacklist';

/**
 * Generate a unique ID for a blacklist rule
 */
export function generateRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Load blacklist configuration from storage
 */
export async function loadBlacklist(): Promise<BlacklistConfig> {
  try {
    const stored = await ProcessConfig.get(BLACKLIST_STORAGE_KEY as any);
    if (stored) {
      return {
        ...DEFAULT_BLACKLIST_CONFIG,
        ...stored,
        rules: stored.rules || [],
      };
    }
  } catch (error) {
    console.error('[SafetyBlacklist] Failed to load from storage:', error);
  }
  return { ...DEFAULT_BLACKLIST_CONFIG };
}

/**
 * Save blacklist configuration to storage
 */
export async function saveBlacklist(config: BlacklistConfig): Promise<boolean> {
  try {
    await ProcessConfig.set(BLACKLIST_STORAGE_KEY as any, config);
    return true;
  } catch (error) {
    console.error('[SafetyBlacklist] Failed to save to storage:', error);
    return false;
  }
}

/**
 * Sync blacklist configuration to Nexus filesystem
 * This allows hook.js to read the blacklist for matching
 */
export async function syncBlacklistToNexus(config: BlacklistConfig): Promise<boolean> {
  try {
    const client = getNexusClient();
    await client.mkdir(CONFIG_DIR, true);
    await client.write(BLACKLIST_CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('[SafetyBlacklist] Synced to Nexus:', BLACKLIST_CONFIG_PATH);
    return true;
  } catch (error) {
    console.error('[SafetyBlacklist] Failed to sync to Nexus:', error);
    throw error;
  }
}

/**
 * Save blacklist and sync to Nexus
 */
export async function saveAndSyncBlacklist(config: BlacklistConfig): Promise<boolean> {
  const saved = await saveBlacklist(config);
  if (!saved) {
    throw new Error('Failed to save blacklist to storage');
  }
  await syncBlacklistToNexus(config);
  return true;
}

/**
 * Add a new blacklist rule
 */
export async function addBlacklistRule(rule: Omit<BlacklistRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<BlacklistConfig> {
  const config = await loadBlacklist();
  const newRule: BlacklistRule = {
    ...rule,
    id: generateRuleId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  config.rules.push(newRule);
  await saveAndSyncBlacklist(config);
  return config;
}

/**
 * Update an existing blacklist rule
 */
export async function updateBlacklistRule(ruleId: string, updates: Partial<Omit<BlacklistRule, 'id' | 'createdAt'>>): Promise<BlacklistConfig | null> {
  const config = await loadBlacklist();
  const index = config.rules.findIndex((r) => r.id === ruleId);
  if (index === -1) {
    return null;
  }
  config.rules[index] = {
    ...config.rules[index],
    ...updates,
    updatedAt: Date.now(),
  };
  await saveAndSyncBlacklist(config);
  return config;
}

/**
 * Delete a blacklist rule
 */
export async function deleteBlacklistRule(ruleId: string): Promise<BlacklistConfig> {
  const config = await loadBlacklist();
  config.rules = config.rules.filter((r) => r.id !== ruleId);
  await saveAndSyncBlacklist(config);
  return config;
}

/**
 * Initialize blacklist on app start
 * Ensures Nexus has the current blacklist config
 * Priority: Nexus > Local storage (to avoid overwriting existing data)
 */
export async function initBlacklist(): Promise<void> {
  try {
    const client = getNexusClient();

    // First check if Nexus already has blacklist config
    try {
      const content = await client.read(BLACKLIST_CONFIG_PATH);
      if (Buffer.isBuffer(content) && content.length > 0) {
        // Nexus has data, sync to local storage for persistence
        const configStr = content.toString('utf-8');
        const nexusConfig = JSON.parse(configStr);
        await ProcessConfig.set(BLACKLIST_STORAGE_KEY as any, nexusConfig);
        console.log('[SafetyBlacklist] Synced from Nexus to local storage');
        return;
      }
    } catch (err) {
      // Nexus doesn't have config, check local storage
    }

    // Nexus doesn't have data, check local storage and sync to Nexus
    const localConfig = await ProcessConfig.get(BLACKLIST_STORAGE_KEY as any);
    if (localConfig && localConfig.rules && localConfig.rules.length > 0) {
      // Local storage has data, sync to Nexus
      await client.mkdir(CONFIG_DIR, true);
      await client.write(BLACKLIST_CONFIG_PATH, JSON.stringify(localConfig, null, 2));
      console.log('[SafetyBlacklist] Synced from local storage to Nexus');
    } else {
      // Neither has data, create empty config in Nexus
      await client.mkdir(CONFIG_DIR, true);
      await client.write(BLACKLIST_CONFIG_PATH, JSON.stringify({ rules: [] }, null, 2));
      console.log('[SafetyBlacklist] Initialized empty config in Nexus');
    }
  } catch (error) {
    console.error('[SafetyBlacklist] Failed to initialize:', error);
  }
}
