/**
 * React injection point for the {@link RendererDataPort}. Each app wraps the
 * shared renderer in <HostBridgeProvider port={…}> with its own adapter
 * (Electron-IPC for desktop, HTTP/WS-to-moss for web); renderer code calls
 * `useHostBridge()` and never imports a backend-specific client directly.
 */

import { createContext, createElement, useContext, type PropsWithChildren, type ReactElement } from 'react';
import type { RendererDataPort } from './RendererDataPort.js';

const HostBridgeContext = createContext<RendererDataPort | null>(null);

export function HostBridgeProvider({ port, children }: PropsWithChildren<{ port: RendererDataPort }>): ReactElement {
  return createElement(HostBridgeContext.Provider, { value: port }, children);
}

export function useHostBridge(): RendererDataPort {
  const port = useContext(HostBridgeContext);
  if (!port) {
    throw new Error('useHostBridge must be used within a HostBridgeProvider');
  }
  return port;
}
