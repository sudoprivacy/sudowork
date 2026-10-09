import { describe, expect, it } from 'vitest';
import { extractWorkspaceFileLinks, resolveWorkspaceFileLink } from '@sudowork/common/workspaceFileLinks';

describe('session file links', () => {
  it.each(['qa-result.md', './qa-result.md', '/workspace/qa-result.md', 'file:///workspace/qa-result.md'])('resolves %s in the session workspace', (href) => {
    expect(resolveWorkspaceFileLink(href, '/workspace')).toEqual({ path: '/workspace/qa-result.md', relativePath: 'qa-result.md' });
  });
  it('preserves encoded spaces, Chinese names, and literal # in filenames', () => {
    expect(resolveWorkspaceFileLink('outputs/%E7%BB%93%E6%9E%9C%20%231.md#section', '/workspace')).toEqual({ path: '/workspace/outputs/结果 #1.md', relativePath: 'outputs/结果 #1.md' });
  });
  it.each(['https://example.com/a.md', 'mailto:test@example.com', '#section', '//example.com', '../../outside.md', '%E0%A4%A', 'javascript:alert(1)'])('does not route %s as a session file', (href) => {
    expect(resolveWorkspaceFileLink(href, '/workspace')).toBeNull();
  });
  it('extracts output links while ignoring web links and code examples', () => {
    expect(extractWorkspaceFileLinks('[Report](qa-result.md) [Preview](<outputs/结果 1.html>) [Web](https://example.com)\n```md\n[Example](unused.md)\n```', '/workspace')).toEqual(['qa-result.md', 'outputs/结果 1.html']);
  });
});
