import { describe, expect, it } from 'vitest';
import { isBrowserViewerUrl } from '../../src/process/services/browserPanel/browserViewerUrl';

describe('Desktop browser viewer preload boundary', () => {
  it('accepts the same installed renderer and a single conversation identity', () => {
    const renderer = 'file:///C:/Program%20Files/SudoWork/index.html#/conversation/one';
    expect(isBrowserViewerUrl('file:///C:/Program%20Files/SudoWork/index.html#/browser-viewer/one', renderer)).toBe(true);
    expect(isBrowserViewerUrl('file:///C:/Program%20Files/SudoWork/index.html#/browser-controls/one', renderer)).toBe(true);
    expect(isBrowserViewerUrl('file:///C:/Other/index.html#/browser-viewer/one', renderer)).toBe(false);
    expect(isBrowserViewerUrl('file:///C:/Program%20Files/SudoWork/index.html#/browser-viewer/one/extra', renderer)).toBe(false);
    expect(isBrowserViewerUrl('file:///C:/Program%20Files/SudoWork/index.html#/browser-controls/one/extra', renderer)).toBe(false);
  });

  it('rejects other origins, ports, protocols and query strings', () => {
    const renderer = 'http://127.0.0.1:5173/index.html';
    expect(isBrowserViewerUrl(`${renderer}#/browser-viewer/one`, renderer)).toBe(true);
    for (const route of ['browser-viewer', 'browser-controls']) {
      for (const target of [`https://example.com/index.html#/${route}/one`, `http://127.0.0.1:5174/index.html#/${route}/one`, `${renderer}?other=1#/${route}/one`, 'javascript:alert(1)', 'invalid']) expect(isBrowserViewerUrl(target, renderer)).toBe(false);
    }
  });
});
