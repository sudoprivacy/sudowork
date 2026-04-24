/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProcessConfig } from '@/process/initStorage';
import { FEATURE_FLAG_DEFINITIONS, type FeatureFlagKey, type FeatureFlagOverrides } from '@/common/featureFlags';

class FeatureFlagService {
  async getOverrides(): Promise<FeatureFlagOverrides> {
    return (await ProcessConfig.get('featureFlags.overrides')) ?? {};
  }

  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    const overrides = await this.getOverrides();
    return overrides[key] ?? FEATURE_FLAG_DEFINITIONS[key].default;
  }

  async setOverride(key: FeatureFlagKey, value: boolean | null): Promise<void> {
    const current = await this.getOverrides();
    const next = { ...current };
    if (value === null) delete next[key];
    else next[key] = value;
    await ProcessConfig.set('featureFlags.overrides', next);
  }

  async getSnapshot(): Promise<Record<FeatureFlagKey, boolean>> {
    const overrides = await this.getOverrides();
    return Object.fromEntries(
      Object.entries(FEATURE_FLAG_DEFINITIONS).map(([k, def]) => [k, overrides[k as FeatureFlagKey] ?? def.default])
    ) as Record<FeatureFlagKey, boolean>;
  }
}

export const featureFlagService = new FeatureFlagService();
