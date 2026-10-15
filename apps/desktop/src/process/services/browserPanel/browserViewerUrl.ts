/** Only the application's own viewer can receive the Desktop preload bridge. */
export function isBrowserViewerUrl(target: string, renderer: string): boolean {
  try {
    const next = new URL(target);
    const current = new URL(renderer);
    return ['file:', 'http:', 'https:'].includes(current.protocol) && next.protocol === current.protocol && next.host === current.host && next.pathname === current.pathname && next.search === current.search && /^#\/browser-(?:viewer|controls)\/[^/?#]+$/.test(next.hash);
  } catch {
    return false;
  }
}
