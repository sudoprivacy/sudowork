/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { AVATAR_BRIDGE_CHANNEL } from '../common/avatarBridge';

/**
 * Bridge message names that are allowed to flow from the main bridge into
 * avatar windows. Any name not in this Set is dropped — avatar windows are
 * deliberately NOT registered with initMainAdapterWithWindow, so this Set
 * is the sole gate for what avatar can observe.
 *
 * Adding a new permitted event MUST be an explicit edit here. This prevents
 * ambient drift where new bridge events accidentally leak into avatar
 * sandbox.
 *
 * Empty in the scaffold commit; populated as MVP-0 / MVP-1 wires up
 * specific events (e.g. 'chat.response.stream').
 */
const AVATAR_ALLOWED_BROADCAST_NAMES: ReadonlySet<string> = new Set<string>([
  // ACP per-message stream — drives the avatar's visual FSM (idle / thinking
  // / error in MVP-0; expanded to 7 states in MVP-1). Channel is named via
  // ipcBridge.acpConversation.responseStream definition in src/common/ipcBridge.ts.
  'chat.response.stream',
  // Screen capture result from wiggle detection — sent by avatarWiggleCapture.ts
  // directly via webContents.send (not through forwardBroadcastToAvatars), but
  // listed here for documentation completeness of the avatar:bridge channel namespace.
  // 'avatar.screen.capture',
]);

const avatarWindows: BrowserWindow[] = [];

/**
 * Register an avatar window to receive allowlisted bridge broadcasts.
 *
 * Avatar windows MUST NOT also be registered via
 * initMainAdapterWithWindow — doing so would defeat the capability
 * isolation by exposing the generic mega-channel
 * (ADAPTER_BRIDGE_EVENT_KEY) to the avatar process.
 *
 * Returns an unregister function (also wired to win.on('closed')).
 */
export function registerAvatarWindow(win: BrowserWindow): () => void {
  avatarWindows.push(win);
  const off = (): void => {
    const idx = avatarWindows.indexOf(win);
    if (idx > -1) avatarWindows.splice(idx, 1);
  };
  win.on('closed', off);
  return off;
}

/**
 * Forward a bridge broadcast to all registered avatar windows, gated by
 * the allowlist. Called from src/adapter/main.ts after the existing
 * fan-out loop.
 */
export function forwardBroadcastToAvatars(name: string, data: unknown): void {
  if (!AVATAR_ALLOWED_BROADCAST_NAMES.has(name)) return;
  for (const win of avatarWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(AVATAR_BRIDGE_CHANNEL, { name, data });
    }
  }
}
