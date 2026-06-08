import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendGeneratedFilesMarker, type GeneratedFileEntry } from '@/common/generatedFiles';

const getConversationMessagesMock = vi.fn();

vi.mock('@process/database', () => ({
  getDatabase: () => ({ getConversationMessages: getConversationMessagesMock }),
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainError: vi.fn(),
}));

const { deliverablesService } = await import('@/process/services/deliverables/DeliverablesService');

const entry = (overrides: Partial<GeneratedFileEntry> = {}): GeneratedFileEntry => ({
  path: '/workspace/hello.html',
  relativePath: 'hello.html',
  kind: 'create',
  ext: 'html',
  mime: 'text/html',
  size: 100,
  createdAt: 1_000,
  ...overrides,
});

const markerMessage = (entries: GeneratedFileEntry[], position: 'left' | 'right' = 'left', type: 'text' | 'tool_call' = 'text') => ({
  type,
  position,
  content: { content: appendGeneratedFilesMarker('', entries) },
});

const paginated = (messages: unknown[]) => ({ data: messages, total: messages.length, page: 0, pageSize: 200, hasMore: false });

describe('DeliverablesService.listForConversation', () => {
  beforeEach(() => {
    getConversationMessagesMock.mockReset();
  });

  afterEach(() => {
    getConversationMessagesMock.mockReset();
  });

  it('returns [] for an empty conversation id', () => {
    expect(deliverablesService.listForConversation('')).toEqual([]);
    expect(getConversationMessagesMock).not.toHaveBeenCalled();
  });

  it('returns [] when no message carries a marker', () => {
    getConversationMessagesMock.mockReturnValue(
      paginated([
        { type: 'text', position: 'left', content: { content: 'plain prose' } },
        { type: 'text', position: 'right', content: { content: 'user message' } },
      ]),
    );
    expect(deliverablesService.listForConversation('c1')).toEqual([]);
  });

  it('extracts files from a single assistant marker message', () => {
    const files = [entry({ path: '/w/a.html', createdAt: 100 }), entry({ path: '/w/b.md', ext: 'md', createdAt: 200 })];
    getConversationMessagesMock.mockReturnValue(paginated([markerMessage(files)]));
    const result = deliverablesService.listForConversation('c1');
    expect(result.map((f) => f.path)).toEqual(['/w/b.md', '/w/a.html']); // newest first
  });

  it('latest occurrence wins when the same path appears in multiple turns', () => {
    getConversationMessagesMock.mockReturnValue(
      paginated([
        markerMessage([entry({ path: '/w/report.pptx', createdAt: 100, size: 1024 })]),
        markerMessage([entry({ path: '/w/report.pptx', createdAt: 500, size: 4096 })]),
      ]),
    );
    const result = deliverablesService.listForConversation('c1');
    expect(result).toHaveLength(1);
    expect(result[0].size).toBe(4096);
    expect(result[0].createdAt).toBe(500);
  });

  it('ignores user (right-position) messages even if they somehow contain a marker', () => {
    getConversationMessagesMock.mockReturnValue(paginated([markerMessage([entry()], 'right')]));
    expect(deliverablesService.listForConversation('c1')).toEqual([]);
  });

  it('ignores non-text message types', () => {
    getConversationMessagesMock.mockReturnValue(paginated([markerMessage([entry()], 'left', 'tool_call')]));
    expect(deliverablesService.listForConversation('c1')).toEqual([]);
  });

  it('returns [] and does not throw when the database call throws', () => {
    getConversationMessagesMock.mockImplementation(() => {
      throw new Error('db unavailable');
    });
    expect(() => deliverablesService.listForConversation('c1')).not.toThrow();
    expect(deliverablesService.listForConversation('c1')).toEqual([]);
  });
});
