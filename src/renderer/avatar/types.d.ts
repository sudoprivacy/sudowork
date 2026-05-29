/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AvatarBridgeMessage } from '@/common/avatarBridge';

declare global {
  interface Window {
    avatarApi: {
      onBridge: (callback: (msg: AvatarBridgeMessage) => void) => () => void;
    };
  }
}

export {};
