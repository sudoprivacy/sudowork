/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API response entry for a single config entry within a config item.
 */
export interface TenantConfigEntry {
  id: number;
  config_key: string;
  config_desc: string | null;
  name: string;
  required: number;
}

/**
 * API response for a config item group.
 */
export interface TenantConfigItem {
  id: number;
  name: string;
  entries: TenantConfigEntry[];
  icon: string | null;
  icon_url: string;
  pinyin: string | null;
  scope?: string;
}

/**
 * Internal state for a single config item's entry values.
 * Maps config_key -> current string value.
 */
export type TenantConfigValues = Record<string, string>;
