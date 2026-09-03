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
 * 适配 electron 的 API 到渲染层,建立 renderer 与 main 的通信桥梁, 与 preload.ts 中的注入对应
 * Wire the renderer <-> main Electron IPC bridge, matching the injection in preload.ts.
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
