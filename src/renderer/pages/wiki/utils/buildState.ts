/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WikiBuildStatus, WikiBuildStatusResponse } from '../api/types';

/**
 * Whether a build is queued or running. Judged by the latest job when known:
 * a cancelled build leaves a never-built wiki at `pending`, which is not active.
 */
export function isBuildActive(live: WikiBuildStatusResponse | undefined, wikiStatus: WikiBuildStatus): boolean {
  const job = live?.latest_job;
  if (job) return job.status === 'queued' || job.status === 'running';
  return (live?.wiki_build_status ?? wikiStatus) === 'running';
}
