/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ipcBridge } from '@/common';

const counts = new Map<string, number>();
const listeners = new Set<(convId: string, count: number) => void>();
let installed = false;

function ensureInstalled(): void {
  if (installed) return;
  installed = true;
  ipcBridge.terminal.activeCountChanged.on(({ conversationId, count }) => {
    if (count > 0) counts.set(conversationId, count);
    else counts.delete(conversationId);
    for (const l of listeners) l(conversationId, count);
  });
}

/**
 * Reactive PTY count for a single conversation. Wraps the
 * `terminal.activeCountChanged` event in a per-component subscription so
 * sidebar rows can show a spinner whenever the conversation has live PTYs.
 *
 * State is module-scope: subscribing late returns the latest known count for
 * that conversation (PTYs don't survive main-process restart, so on fresh
 * boot the Map is empty and we don't miss anything).
 */
export function useTerminalActiveCount(conversationId: string | undefined): number {
  ensureInstalled();
  const [count, setCount] = useState(() => (conversationId ? (counts.get(conversationId) ?? 0) : 0));
  useEffect(() => {
    if (!conversationId) {
      setCount(0);
      return;
    }
    setCount(counts.get(conversationId) ?? 0);
    const handler = (id: string, c: number): void => {
      if (id !== conversationId) return;
      setCount(c);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [conversationId]);
  return count;
}
