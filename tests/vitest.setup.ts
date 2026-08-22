/**
 * Vitest Test Setup
 * Global configuration for extension system tests
 */

import { vi } from 'vitest';

// Global mock for Electron — prevents "Electron failed to install correctly"
// crashes when any test transitively imports `electron` (e.g. via mainLogger).
// Individual tests can override with their own `vi.mock('electron', ...)`.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '',
    getPath: (name: string) => `/tmp/sudowork-test-${name}`,
    getName: () => 'sudowork-test',
    getVersion: () => '0.0.0-test',
    on: () => {},
    once: () => {},
    quit: () => {},
  },
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false, on: () => {} },
}));

// Make this a module
export {};

// Extend global types for testing
declare global {
  // eslint-disable-next-line no-var
  var electronAPI: any;
}

const noop = () => Promise.resolve();

// Mock Electron APIs for testing
const windowControlsMock = {
  minimize: noop,
  maximize: noop,
  unmaximize: noop,
  close: noop,
  isMaximized: () => Promise.resolve(false),
  onMaximizedChange: (): (() => void) => () => void 0,
};

(global as any).electronAPI = {
  emit: noop,
  on: () => {},
  windowControls: windowControlsMock,
};

if (typeof window !== 'undefined') {
  (window as any).electronAPI = (global as any).electronAPI;
}
