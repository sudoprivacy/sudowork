import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILocalKbDocument, ILocalKbSpace } from '@/common/types/localKnowledgeBase';

describe('LocalKnowledgeBaseSkillServer', () => {
  let dataPath = '';
  let serviceMock: ReturnType<typeof createServiceMock>;

  beforeEach(async () => {
    vi.resetModules();
    dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-local-kb-skill-'));
    serviceMock = createServiceMock();
  });

  afterEach(async () => {
    await fs.rm(dataPath, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('reads parsed original document files returned by search fallback', async () => {
    const doc = createDoc('doc-1', '考勤制度.pdf');
    serviceMock.listDocuments.mockReturnValue([doc]);
    await writeExtractedDoc(doc.id, '# 考勤制度\n\n员工需要按时打卡。\n');
    const helpers = await importHelpers();

    const list = await helpers.listReadableFiles('space-1');
    expect(list).toContain('考勤制度.pdf');

    const content = await helpers.readWikiOrParsedDocument('space-1', '考勤制度.pdf');
    expect(content).toContain('员工需要按时打卡');
  });

  it('returns truncated content for large parsed documents instead of 404', async () => {
    const doc = createDoc('doc-large', 'large.pdf');
    serviceMock.listDocuments.mockReturnValue([doc]);
    await writeExtractedDoc(doc.id, 'a'.repeat(600 * 1024));
    const helpers = await importHelpers();

    const content = await helpers.readWikiOrParsedDocument('space-1', 'large.pdf');

    expect(content).toContain('content truncated');
    expect(content?.length).toBeLessThan(530_000);
  });

  it('reads a parsed document by doc id when imported files share a name', async () => {
    const first = createDoc('doc-first', '制度.pdf');
    const second = createDoc('doc-second', '制度.pdf');
    serviceMock.listDocuments.mockReturnValue([first, second]);
    await writeExtractedDoc(first.id, 'first document\n');
    await writeExtractedDoc(second.id, 'second document\n');
    const helpers = await importHelpers();

    const content = await helpers.readParsedDocumentById('space-1', 'doc-second');

    expect(content).toBe('second document\n');
  });

  it('rejects unsafe doc ids', async () => {
    const helpers = await importHelpers();

    expect(helpers.isSafeDocId('../doc')).toBe(false);
    expect(helpers.isSafeDocId('doc_123-ABC')).toBe(true);
  });

  it('searches all non-failed spaces when no space id is provided', async () => {
    serviceMock.listSpaces.mockReturnValue([createSpace('space-1', 'idle'), createSpace('space-2', 'failed')]);
    const helpers = await importHelpers();

    expect(helpers.listSearchableSpaceIds()).toEqual(['space-1']);
  });

  async function importHelpers() {
    vi.doMock('@process/utils', () => ({
      ensureDirectory: vi.fn(),
      getDataPath: () => dataPath,
    }));
    vi.doMock('@process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
    }));
    vi.doMock('@/process/services/local-kb/LocalKnowledgeBaseService', () => ({
      localKnowledgeBaseService: serviceMock,
    }));

    const mod = await import('@/process/services/local-kb/LocalKnowledgeBaseSkillServer');
    return mod.localKnowledgeBaseSkillServerTest;
  }

  async function writeExtractedDoc(docId: string, content: string): Promise<void> {
    const dir = path.join(dataPath, 'sudowork', 'local-kb', 'docs', docId, 'extracted');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${docId}.md`), content, 'utf8');
  }
});

function createServiceMock() {
  const space = createSpace('space-1', 'idle');
  return {
    listSpaces: vi.fn(() => [space]),
    getSpace: vi.fn(() => space),
    listDocuments: vi.fn((): ILocalKbDocument[] => []),
    search: vi.fn().mockResolvedValue({ mode: 'grep-only', hits: [], tookMs: 1, spaceIds: ['space-1'] }),
    searchMany: vi.fn().mockResolvedValue({ mode: 'grep-only', hits: [], tookMs: 1, spaceIds: ['space-1'] }),
  };
}

function createSpace(id: string, buildStatus: ILocalKbSpace['buildStatus']): ILocalKbSpace {
  return {
    id,
    categoryId: null,
    name: 'Space',
    description: null,
    sourceMode: 'files',
    rootPath: null,
    buildStatus,
    retrievalMode: 'grep-only',
    lastBuiltAt: null,
    lastBuildError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createDoc(id: string, fileName: string): ILocalKbDocument {
  return {
    id,
    spaceId: 'space-1',
    fileName,
    relativePath: fileName,
    absolutePath: `/tmp/${fileName}`,
    mimeType: 'application/pdf',
    sizeBytes: 1,
    contentHash: 'hash',
    sourceType: 'files',
    parseStatus: 'parsed',
    parseError: null,
    lastIndexedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}
