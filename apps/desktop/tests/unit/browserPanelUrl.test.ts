import { ALLOWED_BROWSER_URL_SCHEME, normalizeBrowserUrl } from '@/common/browserPanelUrl';

describe('normalizeBrowserUrl', () => {
  it('passes through http and https URLs unchanged', () => {
    expect(normalizeBrowserUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeBrowserUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('allows file:// URLs for AI-generated local previews', () => {
    expect(normalizeBrowserUrl('file:///Users/me/work/index.html')).toBe('file:///Users/me/work/index.html');
  });

  it('allows about: and chrome: schemes used for diagnostic pages', () => {
    expect(normalizeBrowserUrl('about:blank')).toBe('about:blank');
    expect(normalizeBrowserUrl('chrome://gpu')).toBe('chrome://gpu');
    expect(normalizeBrowserUrl('chrome-extension://abc/popup.html')).toBe('chrome-extension://abc/popup.html');
    expect(normalizeBrowserUrl('data:text/html,<p>hi</p>')).toBe('data:text/html,<p>hi</p>');
  });

  it('prepends https:// to bare hosts so the user can type "example.com"', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com');
    expect(normalizeBrowserUrl('  baidu.com/x  ')).toBe('https://baidu.com/x');
  });

  it('returns empty string for empty / whitespace-only input', () => {
    expect(normalizeBrowserUrl('')).toBe('');
    expect(normalizeBrowserUrl('   ')).toBe('');
  });

  it('is case-insensitive on the scheme', () => {
    expect(ALLOWED_BROWSER_URL_SCHEME.test('HTTPS://example.com')).toBe(true);
    expect(ALLOWED_BROWSER_URL_SCHEME.test('File:///tmp/x.html')).toBe(true);
    expect(normalizeBrowserUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
  });
});
