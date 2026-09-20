import type { TenantConfig } from '@sudowork/common/types/tenantConfig';

function inferIconType(src: string): string | undefined {
  const lower = src.toLowerCase();
  if (lower.startsWith('data:image/svg+xml') || lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.startsWith('data:image/png') || lower.endsWith('.png')) return 'image/png';
  if (lower.startsWith('data:image/jpeg') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.startsWith('data:image/webp') || lower.endsWith('.webp')) return 'image/webp';
  return undefined;
}

function ensureIconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (existing) return existing;

  const link = document.createElement('link');
  link.rel = 'icon';
  document.head.appendChild(link);
  return link;
}

export function applyTenantBrowserBranding(config: Required<TenantConfig>): void {
  const title = config.top_name || config.app_name;
  if (title) {
    document.title = title;
  }

  if (!config.logo) return;

  const link = ensureIconLink();
  link.href = config.logo;

  const type = inferIconType(config.logo);
  if (type) {
    link.type = type;
  }
}
