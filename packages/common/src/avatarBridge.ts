/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types between the avatar preload, the avatar renderer, and the
 * main-process avatar broadcast forwarder.
 *
 * The avatar window uses a dedicated IPC channel (AVATAR_BRIDGE_CHANNEL)
 * separate from the generic main bridge mega-channel
 * (ADAPTER_BRIDGE_EVENT_KEY). See src/process/avatarBroadcast.ts for the
 * capability-isolation rationale.
 */

export const AVATAR_BRIDGE_CHANNEL = 'avatar:bridge';

export type AvatarBridgeMessage = {
  name: string;
  data: unknown;
};
