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
import { getNexusClient, CONFIG_DIR, readHookConfig, writeHookConfig, HOOK_CONFIG_PATH, DEFAULT_HOOK_CONFIG } from './SecurityHookFile';
import { mainLog, mainError } from '@process/utils/mainLogger';

/** Unified hook config path (blacklist is stored alongside enabled state) */
export const BLACKLIST_CONFIG_PATH = HOOK_CONFIG_PATH;

/**
 * Generate a unique ID for a blacklist rule
 */
export function generateRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Load blacklist configuration from unified Nexus config
 */
export async function loadBlacklist(): Promise<BlacklistConfig> {
  try {
    const hookConfig = await readHookConfig();
    if (hookConfig) {
      const blacklist = (hookConfig.blacklist || {}) as BlacklistConfig;
      return {
        ...DEFAULT_BLACKLIST_CONFIG,
        ...blacklist,
        rules: blacklist.rules || [],
      };
    }
  } catch (error) {
    mainError('SafetyBlacklist', 'Failed to load from Nexus:', error);
  }
  return { ...DEFAULT_BLACKLIST_CONFIG };
}

/**
 * Save blacklist configuration to Nexus (read-merge-write into unified config)
 */
export async function saveBlacklist(config: BlacklistConfig): Promise<boolean> {
  try {
    const client = getNexusClient();
    await client.mkdir(CONFIG_DIR, true);
    // Read-merge-write: preserve existing enabled/fastPass state
    const existing = await readHookConfig();
    const merged = {
      ...(existing || DEFAULT_HOOK_CONFIG),
      blacklist: config,
    };
    await writeHookConfig(merged);
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
 * Ensures unified hook config contains a blacklist section
 */
export async function initBlacklist(): Promise<void> {
  try {
    const hookConfig = await readHookConfig();
    if (hookConfig && hookConfig.blacklist) {
      mainLog('SafetyBlacklist', 'Blacklist config exists in Nexus');
      return;
    }

    // No blacklist in unified config, add empty blacklist section
    const client = getNexusClient();
    await client.mkdir(CONFIG_DIR, true);
    const merged = {
      ...(hookConfig || DEFAULT_HOOK_CONFIG),
      blacklist: { rules: [] as BlacklistRule[] },
    };
    await writeHookConfig(merged);
    mainLog('SafetyBlacklist', 'Initialized empty blacklist in unified config');
  } catch (error) {
    mainError('SafetyBlacklist', 'Failed to initialize:', error);
  }
}
