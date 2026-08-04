/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import brand from '@brand';
import { STORAGE_KEYS } from '@/common/storageKeys';

async function loadStore() {
  vi.resetModules();
  return import('@/renderer/stores/useTenantStore');
}

describe('useTenantStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses brand.config.json and policy defaults when no cache exists', async () => {
    const { useTenantStore } = await loadStore();
    const state = useTenantStore.getState();

    expect(state).toMatchObject({
      appName: brand.displayName,
      topName: brand.displayName,
      companyName: brand.companyName,
      clientCronEnabled: true,
      clientShowToolCalls: true,
      workspaceUploadLimitBytes: 20 * 1024 * 1024,
      isPolicyConfirmed: false,
    });
  });

  it('uses a complete cached tenant snapshot on startup', async () => {
    const cached = {
      logo: 'https://example.com/cached.png',
      appName: 'Cached App',
      topName: 'Cached Top',
      loginDescription: 'Cached Login',
      aboutName: 'Cached About',
      companyName: 'Cached Company',
      websiteUrl: 'https://cached.example.com',
      privacyPolicyUrl: 'https://cached.example.com/privacy',
      clientCronEnabled: false,
      clientShowToolCalls: false,
      workspaceUploadLimitBytes: 1024,
    };
    localStorage.setItem(STORAGE_KEYS.TENANT, JSON.stringify(cached));

    const { useTenantStore } = await loadStore();

    expect(useTenantStore.getState()).toMatchObject({ ...cached, isPolicyConfirmed: false });
  });

  it('falls back safely when the cache is invalid', async () => {
    localStorage.setItem(STORAGE_KEYS.TENANT, '{bad json');

    const { useTenantStore } = await loadStore();

    expect(useTenantStore.getState().appName).toBe(brand.displayName);
  });

  it('applies remote fields and policies in one update', async () => {
    const { useTenantStore } = await loadStore();

    useTenantStore.getState().applyRemoteConfig({
      logo: 'https://example.com/remote.png',
      logoDark: 'http://unsafe.example.com/logo.png',
      app_name: ' Remote App ',
      top_name: '   ',
      app_company_name: 'Remote Company',
      client_cron_enabled: false,
      client_show_tool_calls: false,
      workspace_upload_limit_bytes: 4096,
    });
    const state = useTenantStore.getState();

    expect(state).toMatchObject({
      logo: 'https://example.com/remote.png',
      appName: 'Remote App',
      topName: brand.displayName,
      companyName: 'Remote Company',
      clientCronEnabled: false,
      clientShowToolCalls: false,
      workspaceUploadLimitBytes: 4096,
      isPolicyConfirmed: true,
    });
    expect(state.logoDark).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.TENANT) ?? 'null')).toMatchObject({ appName: 'Remote App', clientCronEnabled: false });
  });

  it('migrates the legacy merged tenant cache', async () => {
    localStorage.setItem('sudowork_tenant_config', JSON.stringify({ app_name: 'Legacy App', client_cron_enabled: false }));

    const { useTenantStore } = await loadStore();

    expect(useTenantStore.getState()).toMatchObject({ appName: 'Legacy App', clientCronEnabled: false });
    expect(localStorage.getItem(STORAGE_KEYS.TENANT)).not.toBeNull();
    expect(localStorage.getItem('sudowork_tenant_config')).toBeNull();
  });

  it('clears caches and restores defaults', async () => {
    const { useTenantStore } = await loadStore();
    useTenantStore.getState().applyRemoteConfig({ app_name: 'Remote App', client_cron_enabled: false });

    useTenantStore.getState().clearTenantCache();

    expect(useTenantStore.getState()).toMatchObject({ appName: brand.displayName, clientCronEnabled: true, isPolicyConfirmed: false });
    expect(localStorage.getItem(STORAGE_KEYS.TENANT)).toBeNull();
  });
});
