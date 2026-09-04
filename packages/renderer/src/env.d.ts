/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vite/client" />
/// <reference types="electron" />

// Ambient host capabilities the renderer relies on at runtime. The Electron
// preload bridge (`window.electronAPI`) is injected by the hosting desktop app;
// this declaration lets the renderer package type-check standalone. The desktop
// app owns the fully-typed contract (apps/desktop/src/types/electron.ts), which
// applies when the renderer is built/type-checked as part of that app.
interface Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  electronAPI?: any;
}
