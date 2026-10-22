/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { WikiBuildStatusResponse } from '../api/types';
import type { WikiApi } from '../api/wikiApi';

const POLL_MS = 3000;

/**
 * Follow the builds of the given wikis: server-sent `build-events` first, polling
 * `build-status` if the stream fails. Calls `onFinished` when a build ends.
 */
export function useBuildTracker(api: WikiApi, activeWikiIds: string[], onFinished: (wikiId: string) => void): Record<string, WikiBuildStatusResponse> {
  const [statuses, setStatuses] = useState<Record<string, WikiBuildStatusResponse>>({});
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const key = [...activeWikiIds].sort().join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const cleanups: Array<() => void> = [];
    let isDisposed = false;

    const apply = (wikiId: string, status: WikiBuildStatusResponse) => {
      if (isDisposed) return;
      setStatuses((prev) => ({ ...prev, [wikiId]: status }));
      if (status.wiki_build_status !== 'running' && status.wiki_build_status !== 'pending') onFinishedRef.current(wikiId);
    };

    const poll = (wikiId: string) => {
      const timer = setInterval(() => {
        api
          .getBuildStatus(wikiId)
          .then((s) => {
            apply(wikiId, s);
            if (s.wiki_build_status !== 'running' && s.wiki_build_status !== 'pending') clearInterval(timer);
          })
          .catch(() => {});
      }, POLL_MS);
      cleanups.push(() => clearInterval(timer));
    };

    for (const wikiId of ids) {
      api
        .subscribeBuildEvents(wikiId)
        .then((source) => {
          if (isDisposed) {
            source.close();
            return;
          }
          const onEvent = (e: MessageEvent<string>) => {
            try {
              apply(wikiId, JSON.parse(e.data) as WikiBuildStatusResponse);
            } catch {
              /* ignore malformed frames */
            }
          };
          source.addEventListener('progress', onEvent as EventListener);
          source.addEventListener('done', ((e: MessageEvent<string>) => {
            onEvent(e);
            source.close();
          }) as EventListener);
          source.onerror = () => {
            source.close();
            if (!isDisposed) poll(wikiId);
          };
          cleanups.push(() => source.close());
        })
        .catch(() => poll(wikiId));
    }

    return () => {
      isDisposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [api, key]);

  return statuses;
}
