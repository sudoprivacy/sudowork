import { describe, expect, it } from 'vitest';
import { isBuildActive } from '@/renderer/pages/wiki/utils/buildState';
import type { WikiBuildStatusResponse } from '@/renderer/pages/wiki/api/types';

const live = (wikiStatus: WikiBuildStatusResponse['wiki_build_status'], jobStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'): WikiBuildStatusResponse => ({
  wiki_build_status: wikiStatus,
  last_built_at: null,
  last_build_error: null,
  latest_job: jobStatus ? { id: 'j', wikiId: 'w', status: jobStatus, progress: 0, currentStep: null, errorMessage: null, queuedAt: 0, startedAt: null, finishedAt: null } : null,
});

describe('isBuildActive', () => {
  it('follows the latest job when known', () => {
    expect(isBuildActive(live('pending', 'queued'), 'pending')).toBe(true);
    expect(isBuildActive(live('running', 'running'), 'running')).toBe(true);
    // A cancelled first build leaves the wiki at pending: not building, so "build" is offered again.
    expect(isBuildActive(live('pending', 'cancelled'), 'pending')).toBe(false);
    expect(isBuildActive(live('succeeded', 'succeeded'), 'succeeded')).toBe(false);
  });

  it('falls back to the wiki status without job info', () => {
    expect(isBuildActive(undefined, 'running')).toBe(true);
    expect(isBuildActive(undefined, 'pending')).toBe(false);
    expect(isBuildActive(live('running'), 'pending')).toBe(true);
  });
});
