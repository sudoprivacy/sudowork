import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendGeneratedFilesMarker, type GeneratedFileEntry } from '@/common/generatedFiles';

const getConversationMessagesMock = vi.fn();
const getConversationMock = vi.fn();
const listMembersByTeamMock = vi.fn();
const getTeamMock = vi.fn();

vi.mock('@process/database', () => ({
  getDatabase: () => ({ getConversationMessages: getConversationMessagesMock, getConversation: getConversationMock }),
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainError: vi.fn(),
}));

vi.mock('@process/services/team/TeamStore', () => ({
  teamStore: { listMembersByTeam: listMembersByTeamMock, getTeam: getTeamMock },
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
    getConversationMock.mockReset();
    getConversationMock.mockReturnValue({ success: false });
  });

  afterEach(() => {
    getConversationMessagesMock.mockReset();
    getConversationMock.mockReset();
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
      ])
    );
    expect(deliverablesService.listForConversation('c1')).toEqual([]);
  });

  it('extracts files from a single assistant marker message', () => {
    const files = [entry({ path: '/w/a.html', relativePath: 'a.html', createdAt: 100 }), entry({ path: '/w/b.md', relativePath: 'b.md', ext: 'md', createdAt: 200 })];
    getConversationMessagesMock.mockReturnValue(paginated([markerMessage(files)]));
    const result = deliverablesService.listForConversation('c1');
    expect(result.map((f) => f.path)).toEqual(['/w/b.md', '/w/a.html']); // newest first
  });

  it('latest occurrence wins when the same path appears in multiple turns', () => {
    getConversationMessagesMock.mockReturnValue(paginated([markerMessage([entry({ path: '/w/report.pptx', createdAt: 100, size: 1024 })]), markerMessage([entry({ path: '/w/report.pptx', createdAt: 500, size: 4096 })])]));
    const result = deliverablesService.listForConversation('c1');
    expect(result).toHaveLength(1);
    expect(result[0].size).toBe(4096);
    expect(result[0].createdAt).toBe(500);
  });

  it('replaces a stale source marker with its verified moved destination', () => {
    const source = entry({ path: '/w/report.md', relativePath: 'report.md', ext: 'md', createdAt: 100 });
    const moved = entry({
      path: '/outside/report.md',
      relativePath: undefined,
      ext: 'md',
      createdAt: 200,
      movedFrom: { path: source.path, relativePath: source.relativePath },
    });
    getConversationMessagesMock.mockReturnValue(paginated([markerMessage([source]), markerMessage([moved])]));

    expect(deliverablesService.listForConversation('c1')).toEqual([moved]);
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

  it('repairs a stale absolute path when relativePath resolves under the current workspace', () => {
    const workspace = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'deliverables-repair-'));
    const realFile = nodePath.join(workspace, 'report.html');
    fs.writeFileSync(realFile, '<html></html>');
    try {
      getConversationMock.mockReturnValue({ success: true, data: { extra: { workspace } } });
      getConversationMessagesMock.mockReturnValue(paginated([markerMessage([entry({ path: '/old/gone/report.html', relativePath: 'report.html', createdAt: 100 })])]));
      const result = deliverablesService.listForConversation('c1');
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(nodePath.resolve(realFile));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('leaves the path untouched when the stale path resolves nowhere', () => {
    getConversationMock.mockReturnValue({ success: true, data: { extra: { workspace: '/nonexistent-workspace' } } });
    getConversationMessagesMock.mockReturnValue(paginated([markerMessage([entry({ path: '/old/gone/report.html', relativePath: 'report.html', createdAt: 100 })])]));
    const result = deliverablesService.listForConversation('c1');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/old/gone/report.html');
  });

  it('does not repair a stale path to a file outside the workspace', () => {
    const workspace = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'deliverables-repair-root-'));
    const outsideDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'deliverables-repair-outside-'));
    const outsideFile = nodePath.join(outsideDir, 'secret.html');
    fs.writeFileSync(outsideFile, '<html></html>');
    try {
      getConversationMock.mockReturnValue({ success: true, data: { extra: { workspace } } });
      getConversationMessagesMock.mockReturnValue(paginated([markerMessage([entry({ path: '/old/gone/secret.html', relativePath: nodePath.relative(workspace, outsideFile), createdAt: 100 })])]));
      const result = deliverablesService.listForConversation('c1');
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/old/gone/secret.html');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('DeliverablesService.listForTeam', () => {
  beforeEach(() => {
    getConversationMessagesMock.mockReset();
    getConversationMock.mockReset();
    getConversationMock.mockReturnValue({ success: false });
    listMembersByTeamMock.mockReset();
    getTeamMock.mockReset();
    getTeamMock.mockReturnValue(null);
  });

  it('returns [] for an empty team id', () => {
    expect(deliverablesService.listForTeam('')).toEqual([]);
    expect(listMembersByTeamMock).not.toHaveBeenCalled();
  });

  it('aggregates markers across all team members', () => {
    listMembersByTeamMock.mockReturnValue([{ conversation_id: 'c1' }, { conversation_id: 'c2' }]);
    getConversationMessagesMock.mockImplementation((conversationId: string) =>
      conversationId === 'c1' ? paginated([markerMessage([entry({ path: '/w/a.html', relativePath: 'a.html', createdAt: 100 })])]) : paginated([markerMessage([entry({ path: '/w/b.md', relativePath: 'b.md', ext: 'md', createdAt: 200 })])])
    );
    const result = deliverablesService.listForTeam('team1');
    expect(result.map((f) => f.relativePath).sort()).toEqual(['a.html', 'b.md']);
  });

  it('latest wins when members produce the same relativePath', () => {
    listMembersByTeamMock.mockReturnValue([{ conversation_id: 'c1' }, { conversation_id: 'c2' }]);
    getConversationMessagesMock.mockImplementation((conversationId: string) =>
      conversationId === 'c1' ? paginated([markerMessage([entry({ path: '/w/report.html', relativePath: 'report.html', createdAt: 100, size: 1024 })])]) : paginated([markerMessage([entry({ path: '/w/report.html', relativePath: 'report.html', createdAt: 500, size: 4096 })])])
    );
    const result = deliverablesService.listForTeam('team1');
    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBe(500);
    expect(result[0].size).toBe(4096);
  });

  it('skips members whose conversation_id is null', () => {
    listMembersByTeamMock.mockReturnValue([{ conversation_id: null }, { conversation_id: 'c2' }]);
    getConversationMessagesMock.mockReturnValue(paginated([markerMessage([entry({ path: '/w/b.md', relativePath: 'b.md', ext: 'md', createdAt: 200 })])]));
    const result = deliverablesService.listForTeam('team1');
    expect(result.map((f) => f.relativePath)).toEqual(['b.md']);
    expect(getConversationMessagesMock).toHaveBeenCalledTimes(1);
  });
});
