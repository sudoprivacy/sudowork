/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, app, screen } from 'electron';
import * as path from 'path';
import { registerAvatarWindow } from './avatarBroadcast';

const AVATAR_WIDTH = 220;
const AVATAR_HEIGHT = 220;
const SCREEN_MARGIN = 16;

/**
 * Create the floating avatar BrowserWindow.
 *
 * Security posture (MVP-0):
 *   - sandbox: true              renderer has no Node API
 *   - contextIsolation: true     renderer cannot reach Electron internals
 *   - nodeIntegration: false     defense in depth
 *   - dedicated preload          exposes only avatarApi.onBridge for now
 *
 * Window posture:
 *   - transparent + frameless    visual is the SVG orb only, no chrome
 *   - alwaysOnTop                overlay above all other windows
 *   - skipTaskbar                does not clutter taskbar / dock
 *   - hasShadow: false           pure transparency, no rectangular shadow
 *   - resizable: false           fixed 220x220 footprint
 *
 * Initial position: bottom-right corner above the taskbar, similar to an
 * input method floating window. workArea already excludes the taskbar.
 *
 * Avatar windows are registered with avatarBroadcast.ts which provides
 * capability-gated bridge event forwarding via a dedicated AVATAR_BRIDGE_CHANNEL.
 * Avatar windows are NOT added to the main bridge adapterWindowList — see
 * avatarBroadcast.ts for the rationale.
 */
export function createAvatarWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const initialX = workArea.x + workArea.width - AVATAR_WIDTH - SCREEN_MARGIN;
  const initialY = workArea.y + workArea.height - AVATAR_HEIGHT - SCREEN_MARGIN;

  const win = new BrowserWindow({
    width: AVATAR_WIDTH,
    height: AVATAR_HEIGHT,
    x: initialX,
    y: initialY,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/avatar.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerAvatarWindow(win);

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  // Load the avatar renderer. In dev, electron-vite serves multi-HTML
  // entries under ELECTRON_RENDERER_URL with the input key as the path.
  // In production, the build emits a directory matching the input key.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && rendererUrl) {
    void win.loadURL(`${rendererUrl}/src/renderer/avatar/index.html`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/src/renderer/avatar/index.html'));
  }

  return win;
}
