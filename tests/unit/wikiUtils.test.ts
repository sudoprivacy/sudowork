import { describe, expect, it } from 'vitest';
import { batchBySize, fileToBase64, filterOptionByText, splitRelativePath } from '@/renderer/pages/wiki/utils/files';
import { visibilityFrom, visibleToFrom } from '@/renderer/pages/wiki/utils/visibility';
import { cleanWikiMarkdown, isWikiContentFile, wikiLinkTarget } from '@/renderer/pages/wiki/utils/wikiLinks';

describe('wiki visibility mapping', () => {
  it('reads null as everyone', () => {
    expect(visibilityFrom(null, 'me')).toEqual({ mode: 'all', departmentIds: [], userIds: [] });
  });

  it('reads departments and users', () => {
    expect(visibilityFrom({ department_ids: ['d1'], user_ids: null }, 'me').mode).toBe('departments');
    expect(visibilityFrom({ department_ids: null, user_ids: ['u1', 'u2'] }, 'me')).toEqual({ mode: 'users', departmentIds: [], userIds: ['u1', 'u2'] });
  });

  it('reads owner-only, empty and legacy values as only me', () => {
    expect(visibilityFrom({ department_ids: null, user_ids: ['me'] }, 'me').mode).toBe('self');
    expect(visibilityFrom({ department_ids: [], user_ids: [] }, 'me').mode).toBe('self');
    expect(visibilityFrom({ department_ids: null, user_ids: ['admin'] }, 'me').mode).toBe('self');
  });

  it('saves each mode, with an empty pick falling back to only me', () => {
    expect(visibleToFrom({ mode: 'all', departmentIds: [], userIds: [] }, 'me')).toBeNull();
    expect(visibleToFrom({ mode: 'departments', departmentIds: ['d1'], userIds: [] }, 'me')).toEqual({ department_ids: ['d1'], user_ids: null });
    expect(visibleToFrom({ mode: 'users', departmentIds: [], userIds: ['u1'] }, 'me')).toEqual({ department_ids: null, user_ids: ['u1'] });
    expect(visibleToFrom({ mode: 'users', departmentIds: [], userIds: [] }, 'me')).toEqual({ department_ids: null, user_ids: ['me'] });
    expect(visibleToFrom({ mode: 'self', departmentIds: [], userIds: [] }, 'me')).toEqual({ department_ids: null, user_ids: ['me'] });
  });

  it('round-trips through save and read', () => {
    const value = { mode: 'departments' as const, departmentIds: ['d1', 'd2'], userIds: [] };
    expect(visibilityFrom(visibleToFrom(value, 'me'), 'me')).toEqual(value);
  });
});

describe('wiki file helpers', () => {
  it('batches files under the size limit, keeping oversized files alone', () => {
    const files = [{ size: 40 }, { size: 40 }, { size: 40 }, { size: 200 }, { size: 10 }];
    expect(batchBySize(files, 100).map((b) => b.map((f) => f.size))).toEqual([[40, 40], [40], [200], [10]]);
    expect(batchBySize([], 100)).toEqual([]);
  });

  it('splits the top-level folder from a relative path', () => {
    expect(splitRelativePath('docs/a/b.md')).toEqual({ folderName: 'docs', innerPath: 'a/b.md' });
    expect(splitRelativePath('b.md')).toEqual({ folderName: '', innerPath: 'b.md' });
  });

  it('encodes file bytes as base64', async () => {
    expect(await fileToBase64(new Blob(['hello wiki']))).toBe(Buffer.from('hello wiki').toString('base64'));
  });

  it('filters select options by their text', () => {
    expect(filterOptionByText('ENG', { props: { children: 'Engineering' } })).toBe(true);
    expect(filterOptionByText('x', { props: { children: 'Sales' } })).toBe(false);
    expect(filterOptionByText('x', undefined)).toBe(false);
  });
});

describe('wiki viewer links', () => {
  it('hides moss build instructions from the page list', () => {
    expect(isWikiContentFile('WIKI.md')).toBe(true);
    expect(isWikiContentFile('chunk-001-leave.md')).toBe(true);
    expect(isWikiContentFile('AGENTS.md')).toBe(false);
    expect(isWikiContentFile('_moss_meta.json')).toBe(false);
  });

  it('resolves relative page links and ignores external ones', () => {
    expect(wikiLinkTarget('chunk-001-leave.md', 'WIKI.md')).toBe('chunk-001-leave.md');
    expect(wikiLinkTarget('./chunk-002.md#section', 'WIKI.md')).toBe('chunk-002.md');
    expect(wikiLinkTarget('%E4%B8%AD.md', null)).toBe('中.md');
    expect(wikiLinkTarget('../b.md', 'sub/a.md')).toBe('b.md');
    expect(wikiLinkTarget('c.md', 'sub/a.md')).toBe('sub/c.md');
    expect(wikiLinkTarget('https://example.com/a.md', 'WIKI.md')).toBeNull();
    expect(wikiLinkTarget('#top', 'WIKI.md')).toBeNull();
    expect(wikiLinkTarget('images/x.png', 'WIKI.md')).toBeNull();
  });
});

describe('wiki page cleanup', () => {
  it('strips build markers and front matter but keeps the body', () => {
    const raw = '<!-- @final -->\n---\ntitle: 会议室\ntype: chunk\n---\n\n## 大会议室\n提前 2 天预订。<!-- img-id: x -->\n';
    expect(cleanWikiMarkdown(raw)).toBe('## 大会议室\n提前 2 天预订。\n');
  });

  it('leaves plain pages and mid-page rules alone', () => {
    expect(cleanWikiMarkdown('# Title\n\ntext\n\n---\n\nmore')).toBe('# Title\n\ntext\n\n---\n\nmore');
  });
});
