/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { featureFlagService } from '@process/services/featureFlags/FeatureFlagService';

export function initFeatureFlagBridge(): void {
  ipcBridge.featureFlags.getSnapshot.provider(() => featureFlagService.getSnapshot());
  ipcBridge.featureFlags.getOverrides.provider(() => featureFlagService.getOverrides());
  ipcBridge.featureFlags.setOverride.provider(async ({ key, value }) => {
    await featureFlagService.setOverride(key as any, value);
    ipcBridge.featureFlags.changed.emit(await featureFlagService.getSnapshot());
  });
}
