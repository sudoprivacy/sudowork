import defaultLogo from './assets/park-default-logo.svg'

export const DEFAULT_PARK_LOGO = defaultLogo

export function parkLogoUrl(value?: string | null): string {
  if (!value) return DEFAULT_PARK_LOGO
  try {
    const url = new URL(value, location.origin)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : DEFAULT_PARK_LOGO
  } catch {
    return DEFAULT_PARK_LOGO
  }
}

export function setParkFavicon(value?: string | null): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.append(link)
  }
  const url = parkLogoUrl(value)
  link.href = url
  const image = new Image()
  image.onerror = () => {
    if (link?.href === new URL(url, location.origin).href) link.href = DEFAULT_PARK_LOGO
  }
  image.src = url
}
