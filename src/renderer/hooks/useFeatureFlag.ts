/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { FEATURE_FLAG_DEFINITIONS, type FeatureFlagKey } from '@/common/featureFlags';
import { useEffect, useState } from 'react';

export function useFeatureFlag(key: FeatureFlagKey): boolean {
  const [value, setValue] = useState<boolean>(FEATURE_FLAG_DEFINITIONS[key].default);

  useEffect(() => {
    ipcBridge.featureFlags.getSnapshot.invoke().then((snapshot) => {
      if (key in snapshot) setValue(snapshot[key]);
    });
  }, [key]);

  useEffect(() => {
    return ipcBridge.featureFlags.changed.on((snapshot) => {
      if (key in snapshot) setValue(snapshot[key]);
    });
  }, [key]);

  return value;
}
