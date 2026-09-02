/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';

import { bridge } from '@office-ai/platform';
import { forwardBroadcastToAvatars } from '../process/avatarBroadcast';
import { ADAPTER_BRIDGE_EVENT_KEY } from './constant';

/**
 * Bridge event data structure for IPC communication
 * IPC 通信的桥接事件数据结构
 */
interface BridgeEventData {
  name: string;
  data: unknown;
}

const adapterWindowList: Array<BrowserWindow> = [];

/**
 * @description 建立与每一个browserWindow的通信桥梁
 * */
bridge.adapter({
  emit(name, data) {
    // 1. 发送到所有 Electron BrowserWindow / Send to all Electron BrowserWindows
    for (let i = 0, len = adapterWindowList.length; i < len; i++) {
      const win = adapterWindowList[i];
      if (!win.isDestroyed()) {
        win.webContents.send(ADAPTER_BRIDGE_EVENT_KEY, JSON.stringify({ name, data }));
      }
    }
    // 2. 选择性投递到 avatar 窗口（独立 channel + 主进程白名单，capability isolation）
    //    Selectively forward to avatar windows via a dedicated channel + main-side
    //    allowlist. Avatar windows are not in adapterWindowList — see
    //    src/process/avatarBroadcast.ts.
    forwardBroadcastToAvatars(name, data);
  },
  on(emitter) {
    ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, (_event, info) => {
      const { name, data } = JSON.parse(info) as BridgeEventData;
      return Promise.resolve(emitter.emit(name, data));
    });
  },
});

export const initMainAdapterWithWindow = (win: BrowserWindow) => {
  adapterWindowList.push(win);
  const off = () => {
    const index = adapterWindowList.indexOf(win);
    if (index > -1) adapterWindowList.splice(index, 1);
  };
  win.on('closed', off);
  return off;
};
