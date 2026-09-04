/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';
import { AVATAR_BRIDGE_CHANNEL, type AvatarBridgeMessage } from '@common/avatarBridge';

/**
 * Avatar window preload — minimal capability surface.
 *
 * The avatar BrowserWindow is sandboxed and contextIsolated. It MUST NOT
 * have access to the generic main bridge mega-channel
 * (ADAPTER_BRIDGE_EVENT_KEY) — that would allow a prompt-injected LLM to
 * observe arbitrary bridge events and potentially exfiltrate sensitive
 * state via JS-layer leaks.
 *
 * Instead the avatar subscribes to a dedicated channel populated by
 * src/process/avatarBroadcast.ts, gated by an explicit allowlist on the
 * main process side. The renderer here can ONLY:
 *
 *   - subscribe to allowlisted bridge events via avatarApi.onBridge
 *
 * It explicitly cannot:
 *
 *   - emit arbitrary bridge messages (no electronAPI.emit equivalent)
 *   - reach generic ipcRenderer (contextIsolation: true keeps it out of
 *     the renderer's reach)
 *   - touch Node.js APIs (sandbox: true)
 *
 * MVP-1 will add avatarApi.sendMessage via a dedicated 'avatar:sendMessage'
 * IPC handle that hardcodes the underlying bridge call to
 * conversation.sendMessage; arbitrary names will continue to be rejected
 * at the IPC layer.
 */

type AvatarApi = {
  onBridge: (callback: (msg: AvatarBridgeMessage) => void) => () => void;
};

const avatarApi: AvatarApi = {
  onBridge: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: AvatarBridgeMessage): void => {
      callback(msg);
    };
    ipcRenderer.on(AVATAR_BRIDGE_CHANNEL, handler);
    return () => {
      ipcRenderer.off(AVATAR_BRIDGE_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld('avatarApi', avatarApi);
