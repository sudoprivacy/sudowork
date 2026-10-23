/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { WikiBuildStatusResponse } from '../api/types';
import type { WikiApi } from '../api/wikiApi';
import { isBuildActive } from '../utils/buildState';

const POLL_MS = 3000;

/**
 * Follow the builds of the given wikis: server-sent `build-events` first, polling
 * `build-status` if the stream fails. Calls `onFinished` when a build ends.
 * Bump `generation` whenever a build is started so a wiki that was already
 * tracked (e.g. `pending` after a cancel) is followed again.
 */
export function useBuildTracker(api: WikiApi, activeWikiIds: string[], onFinished: (wikiId: string) => void, generation = 0): Record<string, WikiBuildStatusResponse> {
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
      if (!isBuildActive(status, status.wiki_build_status)) onFinishedRef.current(wikiId);
    };

    const poll = (wikiId: string) => {
      const timer = setInterval(() => {
        api
          .getBuildStatus(wikiId)
          .then((s) => {
            apply(wikiId, s);
            if (!isBuildActive(s, s.wiki_build_status)) clearInterval(timer);
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
  }, [api, key, generation]);

  return statuses;
}
