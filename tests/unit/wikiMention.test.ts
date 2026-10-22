import { describe, expect, it } from 'vitest';
import { matchWikiQuery, replaceWikiQuery, resolveMentionedWikis } from '@/renderer/components/wiki/wikiMention';

describe('wiki # mentions', () => {
  it('matches a # query at the cursor', () => {
    expect(matchWikiQuery('ask #hand')).toBe('hand');
    expect(matchWikiQuery('#')).toBe('');
    expect(matchWikiQuery('ask #hand more')).toBeNull();
    expect(matchWikiQuery('issue#12')).toBeNull();
    expect(matchWikiQuery('ask #hand more', 9)).toBe('hand');
  });

  it('replaces the query with the picked name', () => {
    expect(replaceWikiQuery('ask #ha', 'Handbook')).toBe('ask #Handbook ');
    expect(replaceWikiQuery('#', '员工手册')).toBe('#员工手册 ');
    expect(replaceWikiQuery('ask #ha tail', 'Handbook', 7)).toBe('ask #Handbook  tail');
  });

  it('keeps only mentions still present in the text, including names with spaces or CJK', () => {
    const mentions = [
      { id: 'a', name: 'Employee Handbook' },
      { id: 'b', name: '产品规格' },
      { id: 'c', name: 'Deleted' },
      { id: 'a', name: 'Employee Handbook' },
    ];
    expect(resolveMentionedWikis('see #Employee Handbook and #产品规格', mentions)).toEqual(['a', 'b']);
    expect(resolveMentionedWikis('no mentions', mentions)).toEqual([]);
  });
});
