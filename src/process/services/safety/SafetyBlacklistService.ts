/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Blacklist Service
 *
 * Manages blacklist configuration for safety hook service.
 * Nexus is the SINGLE SOURCE OF TRUTH for all blacklist data.
 */

import type { BlacklistConfig, BlacklistRule } from '@/common/safetyTypes';
import { DEFAULT_BLACKLIST_CONFIG } from '@/common/safetyTypes';
import { getNexusClient, CONFIG_DIR, readNexusFileAsUtf8 } from './SecurityHookFile';
import { mainLog, mainError } from '@process/utils/mainLogger';

/** Path in Nexus filesystem for blacklist config */
export const BLACKLIST_CONFIG_PATH = '/safe/config/blacklist';

/**
 * Generate a unique ID for a blacklist rule
 */
export function generateRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Load blacklist configuration from Nexus
 */
export async function loadBlacklist(): Promise<BlacklistConfig> {
  try {
    const configStr = await readNexusFileAsUtf8(BLACKLIST_CONFIG_PATH);
    if (configStr) {
      const config = JSON.parse(configStr) as BlacklistConfig;
      return {
        ...DEFAULT_BLACKLIST_CONFIG,
        ...config,
        rules: config.rules || [],
      };
    }
  } catch (error) {
    mainError('SafetyBlacklist', 'Failed to load from Nexus:', error);
  }
  return { ...DEFAULT_BLACKLIST_CONFIG };
}

/**
 * Save blacklist configuration to Nexus
 */
export async function saveBlacklist(config: BlacklistConfig): Promise<boolean> {
  try {
    const client = getNexusClient();
    await client.mkdir(CONFIG_DIR, true);
    await client.write(BLACKLIST_CONFIG_PATH, JSON.stringify(config, null, 2));
    mainLog('SafetyBlacklist', 'Saved to Nexus');
    return true;
  } catch (error) {
    mainError('SafetyBlacklist', 'Failed to save to Nexus:', error);
    return false;
  }
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
  await saveBlacklist(config);
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
  await saveBlacklist(config);
  return config;
}

/**
 * Delete a blacklist rule
 */
export async function deleteBlacklistRule(ruleId: string): Promise<BlacklistConfig> {
  const config = await loadBlacklist();
  config.rules = config.rules.filter((r) => r.id !== ruleId);
  await saveBlacklist(config);
  return config;
}

/**
 * Initialize blacklist on app start
 * Ensures Nexus has a valid blacklist config file
 */
export async function initBlacklist(): Promise<void> {
  try {
    const configStr = await readNexusFileAsUtf8(BLACKLIST_CONFIG_PATH);
    if (configStr) {
      mainLog('SafetyBlacklist', 'Blacklist config exists in Nexus');
      return;
    }

    // No config exists, create empty config
    const client = getNexusClient();
    await client.mkdir(CONFIG_DIR, true);
    await client.write(BLACKLIST_CONFIG_PATH, JSON.stringify({ rules: [] }, null, 2));
    mainLog('SafetyBlacklist', 'Initialized empty config in Nexus');
  } catch (error) {
    mainError('SafetyBlacklist', 'Failed to initialize:', error);
  }
}
