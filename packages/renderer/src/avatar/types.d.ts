/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AvatarBridgeMessage } from '@sudowork/common/avatarBridge';

declare global {
  interface Window {
    avatarApi: {
      onBridge: (callback: (msg: AvatarBridgeMessage) => void) => () => void;
    };
  }
}

export {};
