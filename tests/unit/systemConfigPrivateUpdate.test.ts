/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@office-ai/platform', () => ({
  storage: {
    buildStorage: vi.fn(() => ({})),
  },
}));

import { getPrivateUpdateFeedBaseUrl, isUrlWithinPrivateUpdateFeed, normalizePrivateUpdateFeedBaseUrl, setSystemConfigCache } from '@/common/systemConfig';

describe('private update feed config', () => {
  afterEach(() => {
    setSystemConfigCache(null);
  });

  it('should normalize full HTTP and HTTPS update feed URLs', () => {
    expect(normalizePrivateUpdateFeedBaseUrl(' http://10.0.1.79:8080/downloads/ ')).toBe('http://10.0.1.79:8080/downloads');
    expect(normalizePrivateUpdateFeedBaseUrl('https://updates.example.internal/downloads///')).toBe('https://updates.example.internal/downloads');
  });

  it('should reject non-URL update feed values', () => {
    expect(normalizePrivateUpdateFeedBaseUrl('10.0.1.79:8080/downloads')).toBeNull();
    expect(normalizePrivateUpdateFeedBaseUrl('ftp://updates.example.internal/downloads')).toBeNull();
  });

  it('should prefer the server-dispatched cos_domain as the private update feed', () => {
    setSystemConfigCache({
      version_update: {
        enabled: 1,
        cos_domain: 'http://10.0.1.79:8080/downloads/',
      },
    });

    expect(getPrivateUpdateFeedBaseUrl()).toBe('http://10.0.1.79:8080/downloads');
  });

  it('should only allow URLs under the configured origin and pathname prefix', () => {
    setSystemConfigCache({
      version_update: {
        enabled: 1,
        cos_domain: 'http://10.0.1.79:8080/downloads',
      },
    });

    expect(isUrlWithinPrivateUpdateFeed('http://10.0.1.79:8080/downloads/Sudowork-1.0.1-win-x64.exe')).toBe(true);
    expect(isUrlWithinPrivateUpdateFeed('http://10.0.1.79:8080/downloads/nested/Sudowork-1.0.1-win-x64.exe')).toBe(true);
    expect(isUrlWithinPrivateUpdateFeed('http://10.0.1.79:8080/other/Sudowork-1.0.1-win-x64.exe')).toBe(false);
    expect(isUrlWithinPrivateUpdateFeed('http://10.0.1.80:8080/downloads/Sudowork-1.0.1-win-x64.exe')).toBe(false);
  });
});
