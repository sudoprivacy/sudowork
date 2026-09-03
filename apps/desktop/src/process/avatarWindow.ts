/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, app, screen } from 'electron';
import * as path from 'path';
import { registerAvatarWindow } from './avatarBroadcast';
import { ProcessConfig } from './initStorage';
import { mainError } from './utils/mainLogger';

const AVATAR_WIDTH = 140;
const AVATAR_HEIGHT = 140;
const SCREEN_MARGIN = 16;

type AvatarBounds = { x: number; y: number; width: number; height: number };

/**
 * Validate that a saved bounds rectangle is still on a connected display.
 * Returns the position when usable, or null when the user changed monitors.
 * Size is always reset to current AVATAR_WIDTH/AVATAR_HEIGHT.
 */
function pickRestorePosition(saved: AvatarBounds | undefined): { x: number; y: number } | null {
  if (!saved) return null;
  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') return null;
  // Confirm the position is on a connected display
  const display = screen.getDisplayMatching({
    x: saved.x,
    y: saved.y,
    width: AVATAR_WIDTH,
    height: AVATAR_HEIGHT,
  });
  if (!display) return null;
  return { x: saved.x, y: saved.y };
}

function defaultBottomRightBounds(): AvatarBounds {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: workArea.x + workArea.width - AVATAR_WIDTH - SCREEN_MARGIN,
    y: workArea.y + workArea.height - AVATAR_HEIGHT - SCREEN_MARGIN,
    width: AVATAR_WIDTH,
    height: AVATAR_HEIGHT,
  };
}

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
  // Resolve initial bounds: prefer the saved last-known position when
  // it still maps to a connected display; otherwise place at the
  // bottom-right above the taskbar.
  // ProcessConfig.get is async — we instantiate the window synchronously
  // with the default position and snap to persisted bounds once they
  // resolve (typically before paint, so the user does not see a jump).
  const initialBounds = defaultBottomRightBounds();
  const persistedBoundsPromise = ProcessConfig.get('avatar.bounds').catch((error: unknown): undefined => {
    mainError('Avatar', 'Failed to read avatar.bounds:', error);
    return undefined;
  });

  const win = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/avatar.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerAvatarWindow(win);

  // If persisted position resolves before the window paints, move to it.
  // Size is always reset to current AVATAR_WIDTH/AVATAR_HEIGHT.
  void persistedBoundsPromise.then((saved): void => {
    const restored = pickRestorePosition(saved as AvatarBounds | undefined);
    if (restored && !win.isDestroyed()) {
      win.setPosition(restored.x, restored.y);
    }
  });

  // Persist the last-known bounds on close so the next launch restores
  // the user's preferred position. 'close' fires before the window is
  // destroyed and getBounds() is still valid.
  win.on('close', () => {
    if (win.isDestroyed()) return;
    const current = win.getBounds();
    void ProcessConfig.set('avatar.bounds', current).catch((error) => {
      mainError('Avatar', 'Failed to persist avatar.bounds:', error);
    });
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  // Load the avatar renderer. electron-vite sets the renderer's vite root
  // to `packages/renderer/src/`, so URLs are relative to that root: the dev server
  // serves `packages/renderer/src/avatar/index.html` at /avatar/index.html, and the
  // production build emits to out/renderer/avatar/index.html.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && rendererUrl) {
    void win.loadURL(`${rendererUrl}/avatar/index.html`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/avatar/index.html'));
  }

  return win;
}
