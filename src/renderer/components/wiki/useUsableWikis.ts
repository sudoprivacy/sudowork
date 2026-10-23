/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { UsableWiki } from '@/renderer/pages/wiki/api/types';
import { useWikiApi } from '@/renderer/pages/wiki/hooks/useWikiApi';

const CACHE_TTL_MS = 60_000;
let cache: { wikis: UsableWiki[]; at: number } | null = null;

/** Wikis the user may use, shared across pickers with a short cache. Disabled when `isEnabled` is false. */
export function useUsableWikis(isEnabled = true) {
  const api = useWikiApi();
  const [wikis, setWikis] = useState<UsableWiki[]>(cache?.wikis ?? []);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(
    async (isForced = false) => {
      if (!isEnabled) return;
      if (!isForced && cache && Date.now() - cache.at < CACHE_TTL_MS) {
        setWikis(cache.wikis);
        return;
      }
      setIsLoading(true);
      try {
        const list = await api.listUsableWikis();
        cache = { wikis: list, at: Date.now() };
        setWikis(list);
      } catch {
        // Older moss servers have no wiki API; the picker just stays empty.
      } finally {
        setIsLoading(false);
      }
    },
    [api, isEnabled]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { wikis, isLoading, refresh };
}
