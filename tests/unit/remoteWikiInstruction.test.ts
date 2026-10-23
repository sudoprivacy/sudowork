import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWikiInstruction, fetchWikiRefs, isSameWikiSet, normalizeWikiIds, planWikiInstruction, wrapWithWikiInstruction } from '@/process/task/remoteWikiInstruction';

describe('remote wiki instruction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes and compares id sets ignoring order and duplicates', () => {
    expect(normalizeWikiIds(['b', 'a', 'b', ''])).toEqual(['a', 'b']);
    expect(isSameWikiSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isSameWikiSet(undefined, [])).toBe(true);
    expect(isSameWikiSet(['a'], ['a', 'c'])).toBe(false);
  });

  it('sends nothing when the selection is unchanged and nothing is mentioned', () => {
    expect(planWikiInstruction({ enabled: ['a', 'b'], advertised: ['b', 'a'] })).toEqual({ selected: null, mentioned: [] });
    expect(planWikiInstruction({ enabled: undefined, advertised: undefined })).toEqual({ selected: null, mentioned: [] });
  });

  it('announces a changed selection, including clearing it', () => {
    expect(planWikiInstruction({ enabled: ['c', 'a'], advertised: ['a', 'b'] }).selected).toEqual(['a', 'c']);
    expect(planWikiInstruction({ enabled: [], advertised: ['a'] }).selected).toEqual([]);
  });

  it('keeps mentions that are not already in the sticky set', () => {
    expect(planWikiInstruction({ enabled: ['a'], advertised: ['a'], mentioned: ['a', 'm'] })).toEqual({ selected: null, mentioned: ['m'] });
  });

  it('builds the selected and per-message blocks', () => {
    const text = buildWikiInstruction({ selected: [{ id: 'w1', name: 'Handbook', description: 'HR rules' }], mentioned: [{ id: 'w2', name: 'Specs' }] });
    expect(text).toContain('[Selected Wikis]');
    expect(text).toContain('- w1: Handbook — HR rules');
    expect(text).toContain('[Wikis for this request]');
    expect(text).toContain('- w2: Specs');
    expect(buildWikiInstruction({ selected: [], mentioned: [] })).toContain('removed all knowledge bases');
    expect(buildWikiInstruction({ selected: null, mentioned: [] })).toBeNull();
  });

  it('keeps the user text after the last [User Request] marker', () => {
    const wrapped = wrapWithWikiInstruction('hello', '[Selected Wikis]\n- w1: A');
    expect(wrapped.split('[User Request]').pop()?.trim()).toBe('hello');
    expect(wrapWithWikiInstruction('hello', null)).toBe('hello');
  });

  it('resolves names from moss and drops wikis the user can no longer use', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ wikis: [{ id: 'w1', name: 'A', description: null }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const refs = await fetchWikiRefs('https://moss.example.com/', 'tok', ['w1', 'gone']);
    expect(refs).toEqual([{ id: 'w1', name: 'A', description: null }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://moss.example.com/api/v1/wikis/usable');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(await fetchWikiRefs('https://moss.example.com', 'tok', [])).toEqual([]);
  });
});
