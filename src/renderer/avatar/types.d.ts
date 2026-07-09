import type { AvatarBridgeMessage } from '@/common/avatarBridge';

declare global {
  interface Window {
    avatarApi: {
      onBridge: (callback: (msg: AvatarBridgeMessage) => void) => () => void;
    };
  }
}

export {};
