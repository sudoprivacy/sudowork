import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { normalizeTenantLogo, resolveTenantConfig } from '@sudowork/common/types/tenantConfig';
import TenantLogo from '@renderer/components/TenantLogo';
import { applyTenantBrowserBranding } from '@renderer/utils/tenantBranding';

const SVG = 'data:image/svg;base64,PHN2Zy8+';
const NORMALIZED_SVG = 'data:image/svg+xml;base64,PHN2Zy8+';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelector('link[rel="icon"]')?.remove();
});

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
});
