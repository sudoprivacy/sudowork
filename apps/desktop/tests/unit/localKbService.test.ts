import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ILocalKbBuildJob, ILocalKbDocument, ILocalKbSpace } from '@/common/types/localKnowledgeBase';

describe('LocalKnowledgeBaseService build queue state', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('reuses an active build job instead of queueing a duplicate', async () => {
    const activeJob = createJob('job-active');
    const db = createDbMock({ activeJob });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce);
    const service = new LocalKnowledgeBaseService();

    const job = service.queueBuild('space-1');

    expect(job).toBe(activeJob);
    expect(db.createLocalKbBuildJob).not.toHaveBeenCalled();
    expect(db.updateLocalKbSpace).not.toHaveBeenCalledWith('space-1', { buildStatus: 'queued' });
    expect(tickOnce).not.toHaveBeenCalled();
  });

  it('creates a queued job and marks the space queued when no active job exists', async () => {
    const createdJob = createJob('job-created');
    const db = createDbMock({ createdJob });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce);
    const service = new LocalKnowledgeBaseService();

    const job = service.queueBuild('space-1');

    expect(job).toBe(createdJob);
    expect(db.createLocalKbBuildJob).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1', mode: 'full' }));
    expect(db.updateLocalKbSpace).toHaveBeenCalledWith('space-1', { buildStatus: 'queued' });
    expect(tickOnce).toHaveBeenCalledTimes(1);
  });

  it('queues an incremental job when a ready space only has new parsed documents', async () => {
    const createdJob = createJob('job-created', 'incremental');
    const db = createDbMock({
      createdJob,
      space: { ...createSpace('space-1'), buildStatus: 'ready', lastBuiltAt: 10 },
      docs: [createDoc('indexed', { lastIndexedAt: 10, updatedAt: 10 }), createDoc('new-doc', { lastIndexedAt: null, updatedAt: 20 })],
    });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce);
    const service = new LocalKnowledgeBaseService();

    const job = service.queueBuild('space-1');

    expect(job).toBe(createdJob);
    expect(db.createLocalKbBuildJob).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1', mode: 'incremental' }));
  });

  it('queues an incremental job after adding files marks a built space idle', async () => {
    const createdJob = createJob('job-created', 'incremental');
    const db = createDbMock({
      createdJob,
      space: { ...createSpace('space-1'), buildStatus: 'idle', lastBuiltAt: 10 },
      docs: [createDoc('indexed', { lastIndexedAt: 10, updatedAt: 10 }), createDoc('new-doc', { lastIndexedAt: null, updatedAt: 20 })],
    });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce);
    const service = new LocalKnowledgeBaseService();

    service.queueBuild('space-1');

    expect(db.createLocalKbBuildJob).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1', mode: 'incremental' }));
  });

  it('repairs legacy indexed state for built spaces that were marked idle by imports', async () => {
    const db = createDbMock({
      space: { ...createSpace('space-1'), buildStatus: 'idle', lastBuiltAt: 10 },
      docs: [createDoc('already-indexed', { lastIndexedAt: 10, updatedAt: 10 }), createDoc('legacy', { lastIndexedAt: null, updatedAt: 9 }), createDoc('new-doc', { lastIndexedAt: null, updatedAt: 20 })],
    });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce);
    const service = new LocalKnowledgeBaseService();

    service.queueBuild('space-1');

    expect(db.markLocalKbDocumentsIndexed).toHaveBeenCalledWith(['legacy'], 10);
  });

  it('keeps full rebuild when an indexed document changed', async () => {
    const createdJob = createJob('job-created');
    const db = createDbMock({
      createdJob,
      space: { ...createSpace('space-1'), buildStatus: 'ready', lastBuiltAt: 10 },
      docs: [createDoc('changed', { lastIndexedAt: 10, updatedAt: 20 }), createDoc('new-doc', { lastIndexedAt: null, updatedAt: 20 })],
    });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce);
    const service = new LocalKnowledgeBaseService();

    service.queueBuild('space-1');

    expect(db.createLocalKbBuildJob).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space-1', mode: 'full' }));
  });

  it('syncs a directory without reparsing unchanged indexed documents', async () => {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-local-kb-source-'));
    const dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-local-kb-data-'));
    const unchangedPath = path.join(sourceDir, 'old.md');
    const addedPath = path.join(sourceDir, 'new.md');
    await fs.writeFile(unchangedPath, '# Old\n\nsame content\n', 'utf8');
    await fs.writeFile(addedPath, '# New\n\nadded content\n', 'utf8');
    const unchangedId = stableDocIdForTest('space-1', 'old.md');
    const staleId = stableDocIdForTest('space-1', 'removed.md');
    const unchangedDoc = createDoc(unchangedId, {
      fileName: 'old.md',
      relativePath: 'old.md',
      absolutePath: unchangedPath,
      contentHash: await sha256FileForTest(unchangedPath),
      sourceType: 'directory',
      lastIndexedAt: 10,
      updatedAt: 10,
    });
    const db = createDbMock({
      docs: [
        unchangedDoc,
        createDoc(staleId, {
          fileName: 'removed.md',
          relativePath: 'removed.md',
          sourceType: 'directory',
          lastIndexedAt: 10,
          updatedAt: 10,
        }),
      ],
    });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce, dataPath);
    const service = new LocalKnowledgeBaseService();

    const docs = await service.setDirectory({ spaceId: 'space-1', directoryPath: sourceDir });

    expect(docs.map((doc) => doc.relativePath).sort()).toEqual(['new.md', 'old.md']);
    expect(db.upsertLocalKbDocument).toHaveBeenCalledTimes(1);
    expect(db.upsertLocalKbDocument).toHaveBeenCalledWith(expect.objectContaining({ relativePath: 'new.md', sourceType: 'directory' }));
    expect(db.deleteLocalKbDocument).toHaveBeenCalledWith(staleId);
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(dataPath, { recursive: true, force: true });
  });

  it('falls back to parsed document grep when wiki output is not built', async () => {
    const dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-local-kb-data-'));
    const doc = createDoc('parsed-doc', { fileName: '考勤制度.pdf' });
    const extractedDir = path.join(dataPath, 'sudowork', 'local-kb', 'docs', doc.id, 'extracted');
    await fs.mkdir(extractedDir, { recursive: true });
    await fs.writeFile(path.join(extractedDir, `${doc.id}.md`), '# 考勤制度\n\n员工需要按时完成考勤打卡。\n', 'utf8');
    const db = createDbMock({ docs: [doc] });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce, dataPath);
    const service = new LocalKnowledgeBaseService();

    const result = await service.search('space-1', '考勤');

    expect(result.mode).toBe('grep-only');
    expect(result.hits.map((hit) => `${hit.file}:${hit.lineNo}`)).toEqual(['考勤制度.pdf:1', '考勤制度.pdf:3']);
    expect(result.hits[0]?.docId).toBe('parsed-doc');
    await fs.rm(dataPath, { recursive: true, force: true });
  });

  it('deletes a document and marks the space idle for rebuild', async () => {
    const dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-local-kb-data-'));
    const doc = createDoc('doc-to-delete', { sourceType: 'file' });
    const docDir = path.join(dataPath, 'sudowork', 'local-kb', 'docs', doc.id);
    await fs.mkdir(docDir, { recursive: true });
    await fs.writeFile(path.join(docDir, 'marker.txt'), 'marker', 'utf8');
    const db = createDbMock({ docs: [doc], space: { ...createSpace('space-1'), buildStatus: 'ready', lastBuiltAt: 10 } });
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce, dataPath);
    const service = new LocalKnowledgeBaseService();

    await service.deleteDocument({ spaceId: 'space-1', documentId: doc.id });

    expect(db.deleteLocalKbDocument).toHaveBeenCalledWith(doc.id);
    expect(db.updateLocalKbSpace).toHaveBeenCalledWith('space-1', expect.objectContaining({ sourceMode: 'files', rootPath: null, buildStatus: 'idle' }));
    await expect(fs.stat(docDir)).rejects.toThrow();
    await fs.rm(dataPath, { recursive: true, force: true });
  });

  it('keeps searchMany results when one space fails', async () => {
    const db = createDbMock();
    const tickOnce = vi.fn();
    const { LocalKnowledgeBaseService } = await importServiceWithMocks(db, tickOnce);
    const service = new LocalKnowledgeBaseService();
    vi.spyOn(service, 'search').mockImplementation(async (spaceId: string) => {
      if (spaceId === 'bad-space') throw new Error('space missing');
      return {
        mode: 'grep-only',
        hits: [
          {
            spaceId,
            file: 'SPACE.md',
            title: 'Space',
            lineNo: 1,
            text: '考勤',
            score: 1,
            source: 'grep',
          },
        ],
        tookMs: 1,
        spaceIds: [spaceId],
      };
    });

    const result = await service.searchMany(['good-space', 'bad-space'], '考勤');

    expect(result.hits.map((hit) => hit.spaceId)).toEqual(['good-space']);
    expect(result.spaceIds).toEqual(['good-space', 'bad-space']);
  });
});

async function importServiceWithMocks(db: ReturnType<typeof createDbMock>, tickOnce: ReturnType<typeof vi.fn>, dataPath = '/tmp/sudowork-local-kb-test') {
  vi.doMock('@process/database', () => ({ getDatabase: () => db }));
  vi.doMock('@process/utils', () => ({
    ensureDirectory: vi.fn(),
    getDataPath: () => dataPath,
  }));
  vi.doMock('@process/utils/mainLogger', () => ({
    mainWarn: vi.fn(),
  }));
  vi.doMock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return { ...actual, default: { ...actual, existsSync: vi.fn(() => true) } };
  });
  vi.doMock('@process/services/scode/ScodeInstallService', () => ({ getScodePath: () => null }));
  vi.doMock('@process/services/libreoffice/LibreOfficeService', () => ({
    libreOfficeService: { checkInstalled: vi.fn().mockResolvedValue({ installed: false }) },
  }));
  vi.doMock('@/process/services/local-kb/buildExecutor', () => ({
    localKnowledgeBuildExecutor: {
      start: vi.fn(),
      tickOnce,
    },
  }));
  return import('@/process/services/local-kb/LocalKnowledgeBaseService');
}

function createDbMock({
  activeJob = null,
  createdJob = createJob('job-created'),
  space = createSpace('space-1'),
  docs = [],
}: {
  activeJob?: ILocalKbBuildJob | null;
  createdJob?: ILocalKbBuildJob;
  space?: ILocalKbSpace;
  docs?: ILocalKbDocument[];
} = {}) {
  const mutableDocs = [...docs];
  return {
    markInterruptedLocalKbBuildJobs: vi.fn(),
    getLocalKbSpace: vi.fn(() => space),
    listLocalKbDocuments: vi.fn(() => mutableDocs),
    getLocalKbDocument: vi.fn((id: string) => mutableDocs.find((doc) => doc.id === id) ?? null),
    upsertLocalKbDocument: vi.fn((input) => {
      const now = Date.now();
      const existingIndex = mutableDocs.findIndex((doc) => doc.id === input.id);
      const doc = createDoc(input.id, {
        spaceId: input.spaceId,
        fileName: input.fileName,
        relativePath: input.relativePath ?? null,
        absolutePath: input.absolutePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash,
        sourceType: input.sourceType,
        parseStatus: input.parseStatus ?? 'pending',
        parseError: input.parseError ?? null,
        updatedAt: now,
      });
      if (existingIndex >= 0) {
        mutableDocs[existingIndex] = { ...mutableDocs[existingIndex]!, ...doc };
      } else {
        mutableDocs.push(doc);
      }
      return doc;
    }),
    updateLocalKbDocumentParse: vi.fn((id: string, updates) => {
      const existingIndex = mutableDocs.findIndex((doc) => doc.id === id);
      if (existingIndex < 0) return null;
      mutableDocs[existingIndex] = {
        ...mutableDocs[existingIndex]!,
        parseStatus: updates.parseStatus,
        parseError: updates.parseError ?? null,
        lastIndexedAt: updates.lastIndexedAt === undefined ? mutableDocs[existingIndex]!.lastIndexedAt : updates.lastIndexedAt,
        updatedAt: Date.now(),
      };
      return mutableDocs[existingIndex]!;
    }),
    markLocalKbDocumentsIndexed: vi.fn(),
    deleteLocalKbDocument: vi.fn((id: string) => {
      const existingIndex = mutableDocs.findIndex((doc) => doc.id === id);
      if (existingIndex >= 0) mutableDocs.splice(existingIndex, 1);
    }),
    getActiveLocalKbBuildJob: vi.fn(() => activeJob),
    createLocalKbBuildJob: vi.fn(() => createdJob),
    updateLocalKbSpace: vi.fn(),
  };
}

function createSpace(id: string): ILocalKbSpace {
  return {
    id,
    categoryId: null,
    name: 'Space',
    description: null,
    sourceMode: 'files',
    rootPath: null,
    buildStatus: 'idle',
    retrievalMode: 'grep-only',
    lastBuiltAt: null,
    lastBuildError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createJob(id: string, mode: ILocalKbBuildJob['mode'] = 'full'): ILocalKbBuildJob {
  return {
    id,
    spaceId: 'space-1',
    mode,
    status: 'queued',
    progress: 0,
    currentStep: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: 1,
  };
}

function createDoc(id: string, overrides: Partial<ILocalKbDocument> = {}): ILocalKbDocument {
  return {
    id,
    spaceId: 'space-1',
    fileName: `${id}.md`,
    relativePath: null,
    absolutePath: `/tmp/${id}.md`,
    mimeType: 'text/markdown',
    sizeBytes: 10,
    contentHash: id,
    sourceType: 'file',
    parseStatus: 'parsed',
    parseError: null,
    lastIndexedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function stableDocIdForTest(spaceId: string, identity: string): string {
  return createHash('sha256').update(`${spaceId}\n${identity}`).digest('hex').slice(0, 32);
}

async function sha256FileForTest(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex');
}
