/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge, logger } from '@office-ai/platform';

// Minimal shape of the preload-injected bridge this adapter consumes. The
// hosting desktop app owns the full contract; only emit/on are used here.
interface ElectronBridgeAPI {
  emit: (name: string, data: unknown) => Promise<unknown> | void;
  on: (callback: (event: { value: string }) => void) => void;
}

interface CustomWindow extends Window {
  electronAPI?: ElectronBridgeAPI;
  __bridgeEmitter?: { emit: (name: string, data: unknown) => void };
}

const win = window as CustomWindow;

/**
 * Wire the shared renderer onto the Electron IPC transport: every `bridge`
 * provider call routes through `window.electronAPI` (injected by the desktop
 * preload, matching `ADAPTER_BRIDGE_EVENT_KEY`). This is the desktop half of the
 * transport-swap seam — the web host imports a moss adapter module instead,
 * against the same `ipcBridge` contract.
 *
 * Wired as an import side-effect (not an exported call) ON PURPOSE: the entry
 * side-effect-imports this module BEFORE importing the renderer mount, so the
 * transport is live before any eager module-level ipcBridge call runs (e.g.
 * useAppMode primes the app mode via ConfigStorage at import time). ES import
 * hoisting means an explicit post-import call would run too late.
 * 适配 electron 的 API 到渲染层，建立 renderer 与 main 的通信桥梁，与 preload.ts 中的注入对应。
 */
bridge.adapter({
  emit(name, data) {
    return win.electronAPI?.emit(name, data);
  },
  on(emitter) {
    win.__bridgeEmitter = emitter;
    win.electronAPI?.on((event) => {
      try {
        const { value } = event;
        const { name, data } = JSON.parse(value);
        emitter.emit(name, data);
      } catch (e) {
        console.warn('[ElectronBridge] JSON parsing error:', e);
      }
    });
  },
});

logger.provider({
  log(log) {
    console.log('process.log', log.type, ...log.logs);
  },
  path() {
    return Promise.resolve('');
  },
});
