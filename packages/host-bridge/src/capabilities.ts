/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the active host transport can serve, so the single shared renderer can
 * gate desktop-only surfaces when it runs on the web (moss) transport.
 *
 * The renderer↔backend transport is swapped at the `@office-ai/platform`
 * `bridge.adapter` seam (desktop = Electron IPC, web = moss). The `ipcBridge`
 * call sites stay identical across both; this flag is the ONLY thing the UI
 * consults to decide whether a desktop-only feature group is reachable. Each
 * boolean maps to a coarse group of `ipcBridge` namespaces that have no moss
 * equivalent and would otherwise reject on the web transport.
 */
export interface HostCapabilities {
  /** Local filesystem: fs / fileWatch / dialog / bdpan. */
  localFilesystem: boolean;
  /** Embedded PTY terminal (terminal.*). */
  terminal: boolean;
  /** CLI / runtime installers: claudeCli, nodeRuntime, python, poppler, libreOffice, fuseT, sudoclaw, mcporter. */
  runtimeManagement: boolean;
  /** Local knowledge base (localKnowledgeBase.*). */
  localKnowledgeBase: boolean;
  /** IM channel management (Telegram / Lark / DingTalk plugins). */
  imChannels: boolean;
  /** App/system control: application.*, update, autoUpdate. */
  appControl: boolean;
  /** Team collaboration (no moss backend today). */
  team: boolean;
}

/** Desktop (Electron) serves every capability. */
export const DESKTOP_CAPABILITIES: HostCapabilities = {
  localFilesystem: true,
  terminal: true,
  runtimeManagement: true,
  localKnowledgeBase: true,
  imChannels: true,
  appControl: true,
  team: true,
};

/** Web (moss) serves only the cross-platform, session-centric surface. */
export const WEB_CAPABILITIES: HostCapabilities = {
  localFilesystem: false,
  terminal: false,
  runtimeManagement: false,
  localKnowledgeBase: false,
  imChannels: false,
  appControl: false,
  team: false,
};
