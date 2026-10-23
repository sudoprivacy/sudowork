/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';

/**
 * The sticky wiki selection stored on a remote conversation (`extra.enabledWikis`).
 * Changes are saved right away; RemoteAgent announces them on the next message.
 */
export function useConversationWikis(conversationId: string, isEnabled: boolean) {
  const [selectedIds, setSelectedIdsState] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIdsState([]);
    if (!isEnabled) return;
    let isCancelled = false;
    ipcBridge.conversation.get
      .invoke({ id: conversationId })
      .then((conversation) => {
        const ids = (conversation?.extra as { enabledWikis?: string[] } | undefined)?.enabledWikis;
        if (!isCancelled && Array.isArray(ids)) setSelectedIdsState(ids);
      })
      .catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, [conversationId, isEnabled]);

  const setSelectedIds = useCallback(
    (ids: string[]) => {
      setSelectedIdsState(ids);
      void ipcBridge.conversation.update.invoke({ id: conversationId, updates: { extra: { enabledWikis: ids } } as never, mergeExtra: true }).catch(() => {});
    },
    [conversationId]
  );

  return { selectedIds, setSelectedIds };
}
