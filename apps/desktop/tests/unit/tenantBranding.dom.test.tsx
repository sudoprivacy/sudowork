import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_TENANT_CONFIG, TENANT_CONFIG_STORAGE_KEY, normalizeTenantLogo, resolveTenantConfig } from '@sudowork/common/types/tenantConfig';
import TenantLogo from '@renderer/components/TenantLogo';
import { applyTenantBrowserBranding } from '@renderer/utils/tenantBranding';
import { TenantConfigProvider } from '@renderer/context/TenantConfigContext';

const state = vi.hoisted(() => ({
  auth: { status: 'authenticated', user: { enterprise_code: 'test' }, ensureValidToken: vi.fn().mockResolvedValue('test-token') },
  mode: { isEnterprise: true },
  verify: vi.fn(),
}));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => state.mode }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { get: vi.fn().mockResolvedValue('https://tenant.example'), set: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@sudowork/common/sudoworkServer', () => ({ getSudoworkServerBaseUrl: vi.fn().mockResolvedValue('https://tenant.example') }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ eeclaw: { verifyServer: { invoke: state.verify } }, sudoworkServer: { getConfig: { invoke: vi.fn().mockResolvedValue({ baseUrl: 'https://tenant.example' }) } } }));

const SVG = 'data:image/svg;base64,PHN2Zy8+';
const NORMALIZED_SVG = 'data:image/svg+xml;base64,PHN2Zy8+';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.querySelector('link[rel="icon"]')?.remove();
});

function mockImages() {
  const images: Array<{ src: string; onload?: () => void }> = [];
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      onload?: () => void;
      constructor() {
        images.push(this);
      }
    }
  );
  return images;
}

describe('shared tenant branding', () => {
  it('normalizes legacy upload MIME types for API and cached configuration', () => {
    expect(resolveTenantConfig({ logo: ` ${SVG} ` }).logo).toBe(NORMALIZED_SVG);
    expect(normalizeTenantLogo('data:image/jpg;base64,photo')).toBe('data:image/jpeg;base64,photo');
    expect(normalizeTenantLogo(NORMALIZED_SVG)).toBe(NORMALIZED_SVG);
    expect(normalizeTenantLogo('https://tenant.example/logo.svg?v=2')).toBe('https://tenant.example/logo.svg?v=2');
    expect(normalizeTenantLogo({ image: 'invalid' })).toBeUndefined();
    expect(normalizeTenantLogo('  ')).toBeUndefined();
  });

  it('uses the same normalized logo and fallback after decode or network failure', () => {
    const { rerender } = render(<TenantLogo src={SVG} fallback='/bundled.svg' alt='Tenant' />);
    const logo = screen.getByAltText('Tenant');
    expect(logo.getAttribute('src')).toBe(NORMALIZED_SVG);
    fireEvent.error(logo);
    expect(logo.getAttribute('src')).toBe('/bundled.svg');
    // A broken fallback must not create a repeated request/error loop.
    fireEvent.error(logo);
    expect(logo.getAttribute('src')).toBe('/bundled.svg');
    rerender(<TenantLogo src='https://tenant.example/new.png' fallback='/bundled.svg' alt='Tenant' />);
    expect(logo.getAttribute('src')).toBe('https://tenant.example/new.png');
    rerender(<TenantLogo fallback='/bundled.svg' alt='Tenant' />);
    expect(logo.getAttribute('src')).toBe('/bundled.svg');
  });

  it('keeps a working favicon while loading and ignores stale tenant responses', () => {
    const images = mockImages();
    applyTenantBrowserBranding(resolveTenantConfig({ logo: SVG, top_name: 'First tenant' }));
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    const bundledIcon = favicon.href;
    expect(bundledIcon).not.toBe(NORMALIZED_SVG);
    expect(images[0].src).toBe(NORMALIZED_SVG);
    applyTenantBrowserBranding(resolveTenantConfig({ logo: 'https://tenant.example/new.png', top_name: 'Second tenant' }));
    images[0].onload?.();
    expect(favicon.href).toBe(bundledIcon);
    images[1].onload?.();
    expect(favicon.href).toBe('https://tenant.example/new.png');
    expect(document.title).toBe('Second tenant');
    applyTenantBrowserBranding(resolveTenantConfig());
    expect(favicon.href).toBe(bundledIcon);
    images[1].onload?.();
    expect(favicon.href).toBe(bundledIcon);
  });

  it.each([true, false])('clears cached branding after a confirmed default response (enterprise=%s)', async (isEnterprise) => {
    state.mode.isEnterprise = isEnterprise;
    state.auth.status = 'authenticated';
    localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify({ logo: SVG, top_name: 'Cached tenant' }));
    const images = mockImages();
    let onResolveConfig!: (value: unknown) => void;
    const response = new Promise((resolve) => {
      onResolveConfig = resolve;
    });
    state.verify.mockReturnValue(response);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => response }));
    render(<TenantConfigProvider>Application</TenantConfigProvider>);
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    const bundledIcon = favicon.href;
    images[0].onload?.();
    expect(favicon.href).toBe(NORMALIZED_SVG);
    await act(async () => onResolveConfig({ success: true, data: {} }));
    await waitFor(() => expect(document.title).toBe(DEFAULT_TENANT_CONFIG.top_name));
    expect(favicon.href).toBe(bundledIcon);
    images[0].onload?.();
    expect(favicon.href).toBe(bundledIcon);
  });

  it('preserves cached login branding before a server response is confirmed', () => {
    state.mode.isEnterprise = true;
    state.auth.status = 'unauthenticated';
    localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify({ logo: SVG, top_name: 'Cached login' }));
    const images = mockImages();
    render(<TenantConfigProvider>Login</TenantConfigProvider>);
    images[0].onload?.();
    expect(document.title).toBe('Cached login');
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href).toBe(NORMALIZED_SVG);
    expect(state.verify).not.toHaveBeenCalled();
  });
});
