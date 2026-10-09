import { randomUUID, createHash } from 'crypto';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDatabase } from '@process/database';
import { getScodePath } from '@process/services/scode/ScodeInstallService';
import { libreOfficeService } from '@process/services/libreoffice/LibreOfficeService';
import { popplerRuntimeService } from '@process/services/poppler/PopplerRuntimeService';
import type {
  ILocalKbAddFilesInput,
  ILocalKbBuildJob,
  ILocalKbCategory,
  ILocalKbCreateCategoryInput,
  ILocalKbCreateSpaceInput,
  ILocalKbDeleteDocumentInput,
  ILocalKbDependencyStatus,
  ILocalKbDocument,
  ILocalKbInstallEmbeddingModelInput,
  ILocalKbSearchHit,
  LocalKbInstallPhase,
  ILocalKbSearchResult,
  ILocalKbSetDirectoryInput,
  ILocalKbSpace,
  ILocalKbUpdateSpaceInput,
} from '@/common/types/localKnowledgeBase';
import { mainWarn } from '@process/utils/mainLogger';
import { ensureLocalKbDirectories, getLocalKbDocDir, getLocalKbDocExtractedDir, getLocalKbDocExtractedPath, getLocalKbDocOriginalDir, getLocalKbSpaceDir, sanitizeLocalKbFileName } from './paths';
import { inferMimeType, parseLocalKbDocument, sha256File } from './documentParser';
import { searchLocalKbSpaceGrep, extractTitle } from './query';
import { localKnowledgeBuildExecutor } from './buildExecutor';
import { localKbEmbeddingModelService } from './embeddingModelService';

const execFileAsync = promisify(execFile);
export class LocalKnowledgeBaseService {
  constructor() {
    ensureLocalKbDirectories();
    getDatabase().markInterruptedLocalKbBuildJobs();
    localKnowledgeBuildExecutor.start();
  }

  listCategories(): ILocalKbCategory[] {
    return getDatabase().listLocalKbCategories();
  }

  createCategory(input: ILocalKbCreateCategoryInput): ILocalKbCategory {
    const name = input.name.trim();
    if (!name) throw new Error('category name is required');
    return getDatabase().createLocalKbCategory({
      id: randomUUID(),
      name,
      description: input.description?.trim() || null,
    });
  }

  updateCategory(id: string, updates: Partial<ILocalKbCreateCategoryInput>): ILocalKbCategory {
    const category = getDatabase().updateLocalKbCategory(id, {
      name: updates.name?.trim(),
      description: updates.description === undefined ? undefined : updates.description?.trim() || null,
    });
    if (!category) throw new Error('category not found');
    return category;
  }

  deleteCategory(id: string): void {
    getDatabase().deleteLocalKbCategory(id);
  }

  listSpaces(categoryId?: string | null): ILocalKbSpace[] {
    return getDatabase().listLocalKbSpaces(categoryId);
  }

  getSpace(id: string): ILocalKbSpace {
    const space = getDatabase().getLocalKbSpace(id);
    if (!space) throw new Error('space not found');
    return space;
  }

  createSpace(input: ILocalKbCreateSpaceInput): ILocalKbSpace {
    const name = input.name.trim();
    if (!name) throw new Error('space name is required');
    return getDatabase().createLocalKbSpace({
      id: randomUUID(),
      categoryId: input.categoryId ?? null,
      name,
      description: input.description?.trim() || null,
      sourceMode: input.sourceMode ?? 'files',
    });
  }

  updateSpace(id: string, updates: ILocalKbUpdateSpaceInput): ILocalKbSpace {
    const space = getDatabase().updateLocalKbSpace(id, {
      categoryId: updates.categoryId,
      name: updates.name?.trim(),
      description: updates.description === undefined ? undefined : updates.description?.trim() || null,
    });
    if (!space) throw new Error('space not found');
    return space;
  }

  async deleteSpace(id: string): Promise<void> {
    this.assertNoActiveBuild(id);
    const docs = getDatabase().listLocalKbDocuments(id);
    getDatabase().deleteLocalKbSpace(id);
    await Promise.all([fs.rm(getLocalKbSpaceDir(id), { recursive: true, force: true }).catch((): undefined => undefined), ...docs.map((doc) => fs.rm(getLocalKbDocDir(doc.id), { recursive: true, force: true }).catch((): undefined => undefined))]);
  }

  listDocuments(spaceId: string): ILocalKbDocument[] {
    return getDatabase().listLocalKbDocuments(spaceId);
  }

  async deleteDocument(input: ILocalKbDeleteDocumentInput): Promise<void> {
    this.getSpace(input.spaceId);
    this.assertNoActiveBuild(input.spaceId);
    const db = getDatabase();
    const doc = db.getLocalKbDocument(input.documentId);
    if (!doc || doc.spaceId !== input.spaceId) throw new Error('document not found');

    db.deleteLocalKbDocument(doc.id);
    await fs.rm(getLocalKbDocDir(doc.id), { recursive: true, force: true }).catch((): undefined => undefined);
    const remainingDocs = db.listLocalKbDocuments(input.spaceId);
    const hasFileDocs = remainingDocs.some((item) => item.sourceType === 'file');
    const hasDirectoryDocs = remainingDocs.some((item) => item.sourceType === 'directory');
    db.updateLocalKbSpace(input.spaceId, {
      sourceMode: hasFileDocs && hasDirectoryDocs ? 'mixed' : hasDirectoryDocs ? 'directory' : 'files',
      rootPath: hasDirectoryDocs ? undefined : null,
      buildStatus: 'idle',
    });
  }

  async addFiles(input: ILocalKbAddFilesInput): Promise<ILocalKbDocument[]> {
    const space = this.getSpace(input.spaceId);
    this.assertNoActiveBuild(space.id);
    const docs: ILocalKbDocument[] = [];
    for (const filePath of input.filePaths) {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      docs.push(await this.importAndParseFile(space.id, filePath, null, 'file'));
    }
    const isMixed = getDatabase()
      .listLocalKbDocuments(space.id)
      .some((doc) => doc.sourceType === 'directory');
    getDatabase().updateLocalKbSpace(space.id, { sourceMode: isMixed ? 'mixed' : 'files', buildStatus: 'idle' });
    return docs;
  }

  async setDirectory(input: ILocalKbSetDirectoryInput): Promise<ILocalKbDocument[]> {
    const space = this.getSpace(input.spaceId);
    this.assertNoActiveBuild(space.id);
    const root = path.resolve(input.directoryPath);
    const rootStat = await fs.stat(root);
    if (!rootStat.isDirectory()) throw new Error('source path is not a directory');
    const files = await collectSupportedFiles(root);
    const previousDocs = getDatabase()
      .listLocalKbDocuments(space.id)
      .filter((doc) => doc.sourceType === 'directory');
    const seenDocIds = new Set<string>();
    const docs: ILocalKbDocument[] = [];
    for (const filePath of files) {
      const relativePath = path.relative(root, filePath);
      seenDocIds.add(stableDocId(space.id, relativePath));
      docs.push(await this.importAndParseFile(space.id, filePath, relativePath, 'directory'));
    }
    const removedDocs = previousDocs.filter((doc) => !seenDocIds.has(doc.id));
    for (const doc of removedDocs) {
      getDatabase().deleteLocalKbDocument(doc.id);
    }
    await Promise.all(removedDocs.map((doc) => fs.rm(getLocalKbDocDir(doc.id), { recursive: true, force: true }).catch((): undefined => undefined)));
    const isMixed = getDatabase()
      .listLocalKbDocuments(space.id)
      .some((doc) => doc.sourceType === 'file');
    getDatabase().updateLocalKbSpace(space.id, {
      sourceMode: isMixed ? 'mixed' : 'directory',
      rootPath: root,
      buildStatus: 'idle',
    });
    return docs;
  }

  queueBuild(spaceId: string): ILocalKbBuildJob {
    const space = this.getSpace(spaceId);
    const activeJob = getDatabase().getActiveLocalKbBuildJob(spaceId);
    if (activeJob) return activeJob;
    const liveDirExists = fsSync.existsSync(getLocalKbSpaceDir(spaceId));
    this.repairLegacyIndexedState(space, liveDirExists);
    const docs = getDatabase()
      .listLocalKbDocuments(spaceId)
      .filter((doc) => doc.parseStatus === 'parsed');
    const hasIndexedDocs = docs.some((doc) => doc.lastIndexedAt !== null);
    const hasNewDocs = docs.some((doc) => doc.lastIndexedAt === null);
    const hasChangedIndexedDocs = docs.some((doc) => doc.lastIndexedAt !== null && doc.updatedAt > doc.lastIndexedAt);
    const mode = space.lastBuiltAt && liveDirExists && hasIndexedDocs && hasNewDocs && !hasChangedIndexedDocs ? 'incremental' : 'full';
    const job = getDatabase().createLocalKbBuildJob({ id: randomUUID(), spaceId, mode });
    getDatabase().updateLocalKbSpace(spaceId, { buildStatus: 'queued' });
    void localKnowledgeBuildExecutor.tickOnce();
    return job;
  }

  getBuildStatus(spaceId: string): { space: ILocalKbSpace; latestJob: ILocalKbBuildJob | null } {
    return {
      space: this.getSpace(spaceId),
      latestJob: getDatabase().getLatestLocalKbBuildJob(spaceId),
    };
  }

  listBuildJobs(spaceId: string, limit = 20): ILocalKbBuildJob[] {
    return getDatabase().listLocalKbBuildJobs(spaceId, limit);
  }

  async search(spaceId: string, query: string): Promise<ILocalKbSearchResult> {
    this.getSpace(spaceId);
    const wikiResult = await searchLocalKbSpaceGrep(spaceId, getLocalKbSpaceDir(spaceId), query);
    if (wikiResult.hits.length > 0) return wikiResult;

    const parsedDocs = getDatabase()
      .listLocalKbDocuments(spaceId)
      .filter((doc) => doc.parseStatus === 'parsed');
    const docResult = await searchParsedDocumentsGrep(spaceId, parsedDocs, query);
    return docResult.hits.length > 0 ? docResult : wikiResult;
  }

  async searchMany(spaceIds: string[], query: string): Promise<ILocalKbSearchResult> {
    const startedAt = Date.now();
    const results = await Promise.all(
      spaceIds.map((spaceId) =>
        this.search(spaceId, query).catch((err): ILocalKbSearchResult => {
          mainWarn('LocalKnowledgeBaseService', `search failed for local KB space ${spaceId}:`, err);
          return { mode: 'grep-only', hits: [], tookMs: 0, spaceIds: [spaceId] };
        })
      )
    );
    return {
      mode: results.some((result) => result.mode === 'hybrid') ? 'hybrid' : 'grep-only',
      hits: results.flatMap((result) => result.hits).sort((a, b) => b.score - a.score),
      tookMs: Date.now() - startedAt,
      spaceIds,
    };
  }

  async getDependencyStatus(): Promise<ILocalKbDependencyStatus> {
    const scodePath = getScodePath() ?? undefined;
    const libreOffice = await libreOfficeService.checkInstalled().catch(() => ({ installed: false as const }));
    const modelPath = localKbEmbeddingModelService.getModelDir();
    const managedPoppler = await popplerRuntimeService.checkManaged().catch(() => ({ installed: false }));
    const [pdftotext, pdfimages] = managedPoppler.installed ? [true, true] : await Promise.all([commandAvailable('pdftotext'), commandAvailable('pdfimages')]);
    return {
      scode: { installed: Boolean(scodePath), path: scodePath },
      localLlm: {
        available: Boolean(scodePath),
        detail: scodePath ? '通过本地 scode agent 调用' : '未检测到 scode，构建会使用 fallback',
      },
      libreOffice: {
        installed: libreOffice.installed,
        version: 'version' in libreOffice ? libreOffice.version : undefined,
      },
      embeddingModel: {
        installed: localKbEmbeddingModelService.checkInstalled(),
        modelId: localKbEmbeddingModelService.getModelId(),
        path: modelPath,
      },
      vectorRuntime: await getVectorRuntimeStatus(),
      poppler: { pdftotext, pdfimages },
    };
  }

  async installEmbeddingModel(onProgress: (phase: LocalKbInstallPhase, percent?: number) => void, options?: ILocalKbInstallEmbeddingModelInput): Promise<void> {
    await localKbEmbeddingModelService.install(onProgress, options);
  }

  private repairLegacyIndexedState(space: ILocalKbSpace, liveDirExists: boolean): void {
    if (!space.lastBuiltAt || !liveDirExists) return;
    const parsedDocs = getDatabase()
      .listLocalKbDocuments(space.id)
      .filter((doc) => doc.parseStatus === 'parsed');
    if (parsedDocs.length === 0) return;
    const builtDocIds = parsedDocs.filter((doc) => doc.lastIndexedAt === null && doc.updatedAt <= space.lastBuiltAt!).map((doc) => doc.id);
    getDatabase().markLocalKbDocumentsIndexed(builtDocIds, space.lastBuiltAt);
  }

  private async importAndParseFile(spaceId: string, filePath: string, relativePath: string | null, sourceType: 'file' | 'directory'): Promise<ILocalKbDocument> {
    const stat = await fs.stat(filePath);
    const hash = await sha256File(filePath);
    const docId = stableDocId(spaceId, relativePath ?? filePath);
    const safeName = sanitizeLocalKbFileName(path.basename(filePath));
    const db = getDatabase();
    const existing = db.getLocalKbDocument(docId);
    if (existing?.contentHash === hash && existing.parseStatus === 'parsed' && fsSync.existsSync(getLocalKbDocExtractedPath(docId))) {
      return existing;
    }

    const originalDir = getLocalKbDocOriginalDir(docId);
    await fs.mkdir(originalDir, { recursive: true });
    const originalPath = path.join(originalDir, safeName);
    await fs.copyFile(filePath, originalPath);

    let doc = db.upsertLocalKbDocument({
      id: docId,
      spaceId,
      fileName: safeName,
      relativePath,
      absolutePath: filePath,
      mimeType: inferMimeType(safeName),
      sizeBytes: stat.size,
      contentHash: hash,
      sourceType,
      parseStatus: 'pending',
    });

    try {
      const parsed = await parseLocalKbDocument(originalPath, safeName);
      await fs.mkdir(getLocalKbDocExtractedDir(docId), { recursive: true });
      await fs.writeFile(getLocalKbDocExtractedPath(docId), parsed.markdown, 'utf8');
      doc = db.updateLocalKbDocumentParse(docId, { parseStatus: 'parsed', parseError: null }) ?? doc;
    } catch (err) {
      doc = db.updateLocalKbDocumentParse(docId, { parseStatus: 'failed', parseError: err instanceof Error ? err.message : String(err) }) ?? doc;
    }
    return doc;
  }

  private assertNoActiveBuild(spaceId: string): void {
    const activeJob = getDatabase().getActiveLocalKbBuildJob(spaceId);
    if (activeJob) {
      throw new Error('knowledge base build is already queued or running');
    }
  }
}

async function collectSupportedFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && isSupportedDocument(entry.name)) {
        out.push(fullPath);
      }
    }
  };
  await walk(root);
  return out;
}

async function searchParsedDocumentsGrep(spaceId: string, docs: ILocalKbDocument[], query: string, limit = 100): Promise<ILocalKbSearchResult> {
  const startedAt = Date.now();
  const hits: ILocalKbSearchHit[] = [];
  const q = query.trim().toLowerCase();
  if (!q) {
    return { mode: 'grep-only', hits: [], tookMs: Date.now() - startedAt, spaceIds: [spaceId] };
  }

  for (const doc of docs) {
    const content = await fs.readFile(getLocalKbDocExtractedPath(doc.id), 'utf8').catch((): string => '');
    if (!content) continue;
    const title = extractTitle(content, doc.fileName);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (!line.toLowerCase().includes(q)) continue;
      hits.push({
        spaceId,
        file: doc.fileName,
        docId: doc.id,
        title,
        lineNo: i + 1,
        text: line.trim(),
        score: 1 / (hits.length + 1),
        source: 'grep',
      });
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }

  return { mode: 'grep-only', hits, tookMs: Date.now() - startedAt, spaceIds: [spaceId] };
}

function isSupportedDocument(fileName: string): boolean {
  return /\.(md|markdown|txt|docx?|pdf|xlsx?|pptx?|odt|rtf)$/i.test(fileName);
}

function stableDocId(spaceId: string, identity: string): string {
  return createHash('sha256').update(`${spaceId}\n${identity}`).digest('hex').slice(0, 32);
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['-v'], { timeout: 3_000 });
    return true;
  } catch {
    try {
      await execFileAsync(command, ['--version'], { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }
}

async function getVectorRuntimeStatus(): Promise<{ available: boolean; detail?: string }> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    await dynamicImport('@xenova/transformers');
    return { available: true };
  } catch (err) {
    return {
      available: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export const localKnowledgeBaseService = new LocalKnowledgeBaseService();
