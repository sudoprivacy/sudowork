import { normalizeTenantLogo, type TenantConfig } from '@sudowork/common/types/tenantConfig';
import defaultLogo from '@renderer/assets/sudowork-icon-dark.svg';

let brandingRevision = 0;

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
  const revision = ++brandingRevision;
  const title = config.top_name || config.app_name;
  if (title) {
    document.title = title;
  }

  const link = ensureIconLink();
  link.href = defaultLogo;
  link.type = 'image/svg+xml';
  const logo = normalizeTenantLogo(config.logo);
  if (!logo) return;

  // Verify remote/data images before replacing the working bundled favicon.
  // A previous tenant's slower request must not overwrite newer branding.
  const image = new Image();
  image.onload = () => {
    if (revision !== brandingRevision) return;
    link.href = logo;
    const type = inferIconType(logo);
    if (type) link.type = type;
    else link.removeAttribute('type');
  };
  image.src = logo;
}
