/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export type FeatureFlagDefinition = {
  default: boolean;
  scope: 'renderer' | 'main' | 'shared';
  description: string;
  owner: string;
};

export const FEATURE_FLAG_DEFINITIONS = {
  cronJobs: {
    default: true,
    scope: 'shared',
    description: 'Enable scheduled task (cron) functionality',
    owner: 'core',
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFINITIONS;
export type FeatureFlagOverrides = Partial<Record<FeatureFlagKey, boolean>>;

export function resolveFlag(key: FeatureFlagKey, overrides?: FeatureFlagOverrides): boolean {
  return overrides?.[key] ?? FEATURE_FLAG_DEFINITIONS[key].default;
}
