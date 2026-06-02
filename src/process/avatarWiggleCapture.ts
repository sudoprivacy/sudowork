/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { AVATAR_BRIDGE_CHANNEL } from '../common/avatarBridge';
import { AvatarWiggleDetector } from './avatarWiggleDetector';
import { captureAroundCursor } from './avatarScreenCapture';
import { mainError } from './utils/mainLogger';

/**
 * Wires together wiggle detection and screen capture for the avatar window.
 *
 * When a mouse wiggle is detected:
 *   1. Capture 800×800 crop around the cursor
 *   2. Send the capture result to the avatar renderer via avatar:bridge
 *
 * The avatar renderer (or a future Gemini Live session manager) receives
 * the capture and forwards it to the LLM.
 *
 * Returns a cleanup function to stop detection.
 */
export function startWiggleCapture(avatarWin: BrowserWindow): () => void {
  const detector = new AvatarWiggleDetector();

  detector.start(async (cursorPos) => {
    const result = await captureAroundCursor(cursorPos);
    if (!result) return;

    // Send to avatar renderer via the dedicated bridge channel
    if (!avatarWin.isDestroyed()) {
      avatarWin.webContents.send(AVATAR_BRIDGE_CHANNEL, {
        name: 'avatar.screen.capture',
        data: {
          imageBase64: result.imageBase64,
          cursorX: result.cursorX,
          cursorY: result.cursorY,
          cropRect: result.cropRect,
        },
      });
    }
  });

  return () => detector.stop();
}
