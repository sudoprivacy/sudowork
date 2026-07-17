import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { AcpConnection } from '@/agent/acp/AcpConnection';
import { getScodePath } from '@process/services/scode/ScodeInstallService';
import { SCODE_HOME } from '@process/services/scode/scodePaths';
import { mainWarn } from '@process/utils/mainLogger';
import { getDatabase } from '@process/database';
import type { AcpPromptResponseUsage, AcpSessionUpdate } from '@/types/acpTypes';
import type { ILocalKbBuildJob, ILocalKbDocument, ILocalKbSpace } from '@/common/types/localKnowledgeBase';
import { LOCAL_KB_META_FILE, LOCAL_KB_SPACE_INDEX_FILE, getLocalKbDocExtractedPath, getLocalKbSpaceDir, getLocalKbSpaceStagePath, pathExists, sanitizeLocalKbFileName } from './paths';
import { extractTitle } from './query';
import { appendLocalKbVectorIndex, buildLocalKbVectorIndex } from './vectorIndex';

const BUILD_TIMEOUT_MS = 30 * 60_000;
const SCODE_OUTPUT_POLL_INTERVAL_MS = 2_000;
const SCODE_OUTPUT_SETTLE_MS = 3_000;
const SCODE_OUTPUT_IDLE_COMPLETE_MS = 30_000;
const LOCAL_KB_DEBUG_PROMPT_FILE = '_sudowork_debug_prompt.md';
const LOCAL_KB_DEBUG_EVENTS_FILE = '_sudowork_debug_events.jsonl';
const LOCAL_KB_DEBUG_RESPONSE_FILE = '_sudowork_debug_response.md';

export class LocalKnowledgeBuildExecutor {
  private running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    const tick = () => {
      this.tickOnce()
        .catch((err) => mainWarn('LocalKbBuildExecutor', 'tick failed:', err))
        .finally(() => {
          this.timer = setTimeout(tick, 2_000);
          this.timer.unref();
        });
    };
    this.timer = setTimeout(tick, 200);
    this.timer.unref();
  }

  async tickOnce(): Promise<void> {
    const db = getDatabase();
    const jobs = db.listQueuedLocalKbBuildJobs(Math.max(0, 2 - this.running.size));
    for (const job of jobs) {
      if (this.running.has(job.id)) continue;
      this.running.add(job.id);
      void this.runJob(job).finally(() => {
        this.running.delete(job.id);
      });
    }
  }

  async runJob(job: ILocalKbBuildJob): Promise<void> {
    const db = getDatabase();
    const space = db.getLocalKbSpace(job.spaceId);
    if (!space) {
      db.updateLocalKbBuildJob(job.id, { status: 'failed', errorMessage: 'space not found', finishedAt: Date.now() });
      return;
    }

    const stageDir = getLocalKbSpaceStagePath(space.id, job.id);
    const inputDir = path.join(stageDir, 'input');
    try {
      db.updateLocalKbBuildJob(job.id, { status: 'running', progress: 5, currentStep: '准备构建目录', startedAt: Date.now() });
      db.updateLocalKbSpace(space.id, { buildStatus: 'running', lastBuildError: null });
      await fs.rm(stageDir, { recursive: true, force: true });
      await fs.mkdir(inputDir, { recursive: true });

      const docs = db.listLocalKbDocuments(space.id).filter((doc) => doc.parseStatus === 'parsed');
      if (docs.length === 0) throw new Error('no parsed documents to build');
      if (job.mode === 'incremental' && (await this.tryIncrementalBuild(job, space, docs, stageDir))) {
        return;
      }

      db.updateLocalKbBuildJob(job.id, { progress: 10, currentStep: `准备输入文档（${docs.length} 个已解析文档）` });
      await this.stageInputs(docs, inputDir);

      db.updateLocalKbBuildJob(job.id, { progress: 25, currentStep: `调用本地 scode 构建 Wiki（全量重建 ${docs.length} 个文档）` });
      const isScodeBuilt = await this.tryScodeBuild(stageDir, space, job.id).catch((err): boolean => {
        mainWarn('LocalKbBuildExecutor', 'scode build failed, using deterministic fallback:', err);
        return false;
      });
      if (!isScodeBuilt) {
        db.updateLocalKbBuildJob(job.id, { progress: 45, currentStep: '使用本地 fallback 生成 Wiki' });
        await this.writeFallbackWiki(stageDir, space, docs);
      }

      await this.validateOutput(stageDir);
      const outputStatus = await inspectWikiOutput(stageDir);
      db.updateLocalKbBuildJob(job.id, { progress: 80, currentStep: `写入元信息（${outputStatus.existingChunkCount} 个 chunk）` });
      await this.writeMeta(stageDir, space, docs, isScodeBuilt ? 'scode' : 'fallback');
      db.updateLocalKbBuildJob(job.id, { progress: 85, currentStep: '构建向量索引' });
      const vectorResult = await buildLocalKbVectorIndex(stageDir).catch((): { ok: false; reason: string } => ({ ok: false, reason: 'error' }));
      const vectorStep = 'count' in vectorResult ? `向量索引已构建（${vectorResult.count} 段），发布知识库` : `向量索引跳过（${vectorResult.reason}），发布知识库`;
      db.updateLocalKbBuildJob(job.id, {
        progress: 90,
        currentStep: vectorStep,
      });
      await this.publish(stageDir, getLocalKbSpaceDir(space.id));
      const indexedAt = Date.now();
      db.markLocalKbDocumentsIndexed(
        docs.map((doc) => doc.id),
        indexedAt
      );

      db.updateLocalKbBuildJob(job.id, { status: 'success', progress: 100, currentStep: '构建完成', finishedAt: Date.now() });
      if (db.getLatestLocalKbBuildJob(space.id)?.id === job.id) {
        db.updateLocalKbSpace(space.id, {
          buildStatus: 'ready',
          retrievalMode: vectorResult.ok ? 'hybrid' : 'grep-only',
          lastBuiltAt: Date.now(),
          lastBuildError: null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.updateLocalKbBuildJob(job.id, { status: 'failed', currentStep: '构建失败', errorMessage: message, finishedAt: Date.now() });
      if (db.getLatestLocalKbBuildJob(space.id)?.id === job.id) {
        db.updateLocalKbSpace(space.id, { buildStatus: 'failed', lastBuildError: message });
      }
      await fs.rm(stageDir, { recursive: true, force: true }).catch((): undefined => undefined);
    }
  }

  private async tryIncrementalBuild(job: ILocalKbBuildJob, space: ILocalKbSpace, docs: ILocalKbDocument[], stageDir: string): Promise<boolean> {
    const db = getDatabase();
    const liveDir = getLocalKbSpaceDir(space.id);
    const newDocs = docs.filter((doc) => doc.lastIndexedAt === null);
    const changedIndexedDocs = docs.filter((doc) => doc.lastIndexedAt !== null && doc.updatedAt > doc.lastIndexedAt);
    if (newDocs.length === 0) return false;
    if (changedIndexedDocs.length > 0) {
      db.updateLocalKbBuildJob(job.id, {
        progress: 8,
        currentStep: `检测到 ${changedIndexedDocs.length} 个已索引文档被修改，切换全量重建`,
      });
      return false;
    }
    if (!(await pathExists(path.join(liveDir, LOCAL_KB_SPACE_INDEX_FILE)))) return false;

    db.updateLocalKbBuildJob(job.id, { progress: 10, currentStep: `增量构建：复制现有 Wiki，新增 ${newDocs.length} 个文档` });
    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(stageDir), { recursive: true });
    await fs.cp(liveDir, stageDir, { recursive: true, force: true });
    await Promise.all([LOCAL_KB_DEBUG_PROMPT_FILE, LOCAL_KB_DEBUG_EVENTS_FILE, LOCAL_KB_DEBUG_RESPONSE_FILE].map((file) => fs.rm(path.join(stageDir, file), { force: true }).catch((): undefined => undefined)));

    const incrementalDir = path.join(stageDir, '.incremental-scode');
    const incrementalInputDir = path.join(incrementalDir, 'input');
    await fs.rm(incrementalDir, { recursive: true, force: true });
    await fs.mkdir(incrementalInputDir, { recursive: true });
    await this.stageInputs(newDocs, incrementalInputDir);

    db.updateLocalKbBuildJob(job.id, { progress: 25, currentStep: `增量调用本地 scode 拆分新增文档（${newDocs.length} 个文档）` });
    const isScodeBuilt = await this.tryScodeBuild(incrementalDir, space, job.id, buildWikiBuilderPrompt(space, 'incremental')).catch((err): boolean => {
      mainWarn('LocalKbBuildExecutor', 'incremental scode build failed, using deterministic fallback:', err);
      return false;
    });
    let addedChunkFiles: string[];
    if (isScodeBuilt) {
      db.updateLocalKbBuildJob(job.id, { progress: 70, currentStep: '合并 scode 增量 chunk' });
      addedChunkFiles = await this.mergeIncrementalScodeWiki(stageDir, incrementalDir);
    } else {
      db.updateLocalKbBuildJob(job.id, { progress: 70, currentStep: '增量 scode 失败，使用本地 fallback chunk' });
      addedChunkFiles = await this.writeIncrementalFallbackWiki(stageDir, space, newDocs);
    }
    await copyIncrementalDebugFiles(incrementalDir, stageDir);
    await fs.rm(incrementalDir, { recursive: true, force: true }).catch((): undefined => undefined);
    await this.validateOutput(stageDir);

    const outputStatus = await inspectWikiOutput(stageDir);
    db.updateLocalKbBuildJob(job.id, { progress: 80, currentStep: `写入元信息（${outputStatus.existingChunkCount} 个 chunk）` });
    await this.writeMeta(stageDir, space, docs, 'incremental');
    db.updateLocalKbBuildJob(job.id, { progress: 85, currentStep: `增量追加向量索引（${addedChunkFiles.length} 个新增 chunk）` });
    const vectorResult = await appendLocalKbVectorIndex(stageDir, addedChunkFiles).catch((): { ok: false; reason: string } => ({ ok: false, reason: 'error' }));
    const vectorStep = 'appended' in vectorResult ? `向量索引已追加（新增 ${vectorResult.appended} 段，总计 ${vectorResult.count} 段），发布知识库` : `向量索引跳过（${vectorResult.reason}），发布知识库`;
    db.updateLocalKbBuildJob(job.id, { progress: 90, currentStep: vectorStep });
    await this.publish(stageDir, liveDir);

    const indexedAt = Date.now();
    db.markLocalKbDocumentsIndexed(
      newDocs.map((doc) => doc.id),
      indexedAt
    );
    db.updateLocalKbBuildJob(job.id, { status: 'success', progress: 100, currentStep: '增量构建完成', finishedAt: Date.now() });
    if (db.getLatestLocalKbBuildJob(space.id)?.id === job.id) {
      db.updateLocalKbSpace(space.id, {
        buildStatus: 'ready',
        retrievalMode: vectorResult.ok ? 'hybrid' : 'grep-only',
        lastBuiltAt: Date.now(),
        lastBuildError: null,
      });
    }
    return true;
  }

  private async stageInputs(docs: ILocalKbDocument[], inputDir: string): Promise<void> {
    for (const doc of docs) {
      const source = getLocalKbDocExtractedPath(doc.id);
      const baseName = sanitizeLocalKbFileName(path.basename(doc.fileName, path.extname(doc.fileName))).slice(0, 120) || 'document';
      const name = `${baseName}-${doc.id.slice(0, 8)}.md`;
      await fs.copyFile(source, path.join(inputDir, name));
    }
  }

  private async tryScodeBuild(stageDir: string, space: ILocalKbSpace, jobId: string, prompt = buildWikiBuilderPrompt(space, 'full')): Promise<boolean> {
    const scodePath = getScodePath();
    if (!scodePath) return false;

    const connection = new AcpConnection();
    const db = getDatabase();
    const startedAt = Date.now();
    try {
      db.updateLocalKbBuildJob(jobId, { progress: 25, currentStep: `启动本地 scode ACP（stage: ${path.basename(stageDir)}）` });
      await connection.connect('scode', scodePath, stageDir, ['acp'], {
        SUDO_CODE_CONFIG_HOME: SCODE_HOME,
      });
      db.updateLocalKbBuildJob(jobId, { progress: 25, currentStep: `本地 scode ACP 已连接（${formatElapsed(startedAt)}），创建构建会话` });
      await connection.newSession(stageDir);
      db.updateLocalKbBuildJob(jobId, { progress: 25, currentStep: `构建会话已创建（${formatElapsed(startedAt)}），发送 Wiki 构建提示词` });
      await writeScodeDebugPrompt(stageDir, prompt, scodePath);
      const debugRecorder = createScodeDebugRecorder(stageDir, startedAt);
      connection.onSessionUpdate = debugRecorder.onSessionUpdate;
      connection.onPromptUsage = debugRecorder.onPromptUsage;
      connection.onEndTurn = debugRecorder.onEndTurn;
      db.updateLocalKbBuildJob(jobId, { progress: 25, currentStep: `已发送 Wiki 构建提示词（${prompt.length} 字符），等待 scode 输出文件；调试日志：${LOCAL_KB_DEBUG_EVENTS_FILE}` });
      const waitAbortController = new AbortController();
      const promptPromise = connection.sendPrompt(prompt).catch(async (err) => {
        if ((await inspectWikiOutput(stageDir)).isComplete) return;
        await debugRecorder.recordError(err);
        throw err;
      });
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('scode wiki build timed out')), BUILD_TIMEOUT_MS);
        timeout.unref();
      });
      try {
        await Promise.race([promptPromise, waitForScodeWikiOutput(stageDir, jobId, startedAt, waitAbortController.signal), timeoutPromise]);
      } finally {
        waitAbortController.abort();
        if (timeout) clearTimeout(timeout);
      }
      return hasValidWikiOutput(stageDir);
    } finally {
      await connection.disconnect().catch((): undefined => undefined);
    }
  }

  private async writeFallbackWiki(stageDir: string, space: ILocalKbSpace, docs: ILocalKbDocument[]): Promise<void> {
    const chunks: Array<{ file: string; title: string; content: string }> = [];
    for (let i = 0; i < docs.length; i += 1) {
      const doc = docs[i]!;
      const content = await fs.readFile(getLocalKbDocExtractedPath(doc.id), 'utf8');
      const topic = slugify(path.basename(doc.fileName, path.extname(doc.fileName))) || `document-${i + 1}`;
      const file = `chunk-${String(i + 1).padStart(3, '0')}-${topic}.md`;
      const title = extractTitle(content, doc.fileName);
      const chunk = `---\ntitle: ${escapeYamlString(title)}\ntype: chunk\ntopic: ${topic}\n---\n\n${content.trim()}\n`;
      chunks.push({ file, title, content: chunk });
      await fs.writeFile(path.join(stageDir, file), chunk, 'utf8');
    }

    const index = ['---', `title: ${escapeYamlString(space.name)}`, 'type: index', '---', '', `# ${space.name}`, '', space.description || '本地知识库由 Sudowork 从本地文档构建。', '', '## 文件清单', '', ...chunks.map((chunk) => `- [${chunk.title}](./${chunk.file})`), ''].join('\n');
    await fs.writeFile(path.join(stageDir, LOCAL_KB_SPACE_INDEX_FILE), index, 'utf8');
  }

  private async validateOutput(stageDir: string): Promise<void> {
    if (!(await hasValidWikiOutput(stageDir))) {
      throw new Error(`wiki output must include ${LOCAL_KB_SPACE_INDEX_FILE} and at least one chunk file`);
    }
  }

  private async writeMeta(stageDir: string, space: ILocalKbSpace, docs: ILocalKbDocument[], builder: 'scode' | 'fallback' | 'incremental'): Promise<void> {
    const entries = await fs.readdir(stageDir, { withFileTypes: true });
    const pages = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && (entry.name === LOCAL_KB_SPACE_INDEX_FILE || /^chunk-\d+-.+\.md$/i.test(entry.name)))
        .map(async (entry) => {
          const content = await fs.readFile(path.join(stageDir, entry.name), 'utf8').catch((): string => '');
          return {
            file: entry.name,
            type: entry.name === LOCAL_KB_SPACE_INDEX_FILE ? 'index' : 'chunk',
            title: extractTitle(content, entry.name),
          };
        })
    );
    await fs.writeFile(
      path.join(stageDir, LOCAL_KB_META_FILE),
      JSON.stringify(
        {
          version: 1,
          spaceId: space.id,
          name: space.name,
          description: space.description,
          builtAt: Date.now(),
          builder,
          docIds: docs.map((doc) => doc.id),
          sourceMode: space.sourceMode,
          chunkCount: pages.filter((page) => page.type === 'chunk').length,
          imageCount: 0,
          pages,
        },
        null,
        2
      ),
      'utf8'
    );
  }

  private async mergeIncrementalScodeWiki(stageDir: string, incrementalDir: string): Promise<string[]> {
    const generatedChunkFiles = (await fs.readdir(incrementalDir, { withFileTypes: true }).catch((): Dirent[] => []))
      .filter((entry) => entry.isFile() && /^chunk-\d+-.+\.md$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (generatedChunkFiles.length === 0) throw new Error('incremental scode output did not include chunk files');

    const existingChunkFiles = (await fs.readdir(stageDir, { withFileTypes: true }).catch((): Dirent[] => [])).filter((entry) => entry.isFile() && /^chunk-\d+-.+\.md$/i.test(entry.name)).map((entry) => entry.name);
    let nextIndex = Math.max(0, ...existingChunkFiles.map((file) => Number(file.match(/^chunk-(\d+)/i)?.[1] ?? 0))) + 1;
    const links: Array<{ title: string; file: string }> = [];
    const addedFiles: string[] = [];

    for (const sourceFile of generatedChunkFiles) {
      const content = await fs.readFile(path.join(incrementalDir, sourceFile), 'utf8');
      const title = extractTitle(content, sourceFile);
      const topic = slugify(sourceFile.replace(/^chunk-\d+-/i, '').replace(/\.md$/i, '')) || `incremental-${nextIndex}`;
      const targetFile = `chunk-${String(nextIndex).padStart(3, '0')}-${topic}.md`;
      nextIndex += 1;
      await fs.writeFile(path.join(stageDir, targetFile), content, 'utf8');
      links.push({ title, file: targetFile });
      addedFiles.push(targetFile);
    }

    await appendIncrementalLinks(stageDir, links);
    return addedFiles;
  }

  private async writeIncrementalFallbackWiki(stageDir: string, space: ILocalKbSpace, docs: ILocalKbDocument[]): Promise<string[]> {
    const existingChunkFiles = (await fs.readdir(stageDir, { withFileTypes: true }).catch((): Dirent[] => [])).filter((entry) => entry.isFile() && /^chunk-\d+-.+\.md$/i.test(entry.name)).map((entry) => entry.name);
    let nextIndex = Math.max(0, ...existingChunkFiles.map((file) => Number(file.match(/^chunk-(\d+)/i)?.[1] ?? 0))) + 1;
    const links: Array<{ title: string; file: string }> = [];
    const addedFiles: string[] = [];

    for (const doc of docs) {
      const content = await fs.readFile(getLocalKbDocExtractedPath(doc.id), 'utf8');
      const title = extractTitle(content, doc.fileName);
      const topic = slugify(path.basename(doc.fileName, path.extname(doc.fileName))) || `document-${nextIndex}`;
      const parts = splitIncrementalContent(content);
      for (let i = 0; i < parts.length; i += 1) {
        const partTitle = parts.length > 1 ? `${title} ${i + 1}` : title;
        const suffix = parts.length > 1 ? `${topic}-part-${i + 1}` : topic;
        const file = `chunk-${String(nextIndex).padStart(3, '0')}-${suffix}.md`;
        nextIndex += 1;
        const chunk = ['---', `title: ${escapeYamlString(partTitle)}`, 'type: chunk', `topic: ${suffix}`, `source_doc_id: ${doc.id}`, `source_file: ${escapeYamlString(doc.relativePath || doc.fileName)}`, '---', '', parts[i]!.trim(), ''].join('\n');
        await fs.writeFile(path.join(stageDir, file), chunk, 'utf8');
        links.push({ title: partTitle, file });
        addedFiles.push(file);
      }
    }

    if (!(await pathExists(path.join(stageDir, LOCAL_KB_SPACE_INDEX_FILE)))) {
      await fs.writeFile(path.join(stageDir, LOCAL_KB_SPACE_INDEX_FILE), ['---', `title: ${escapeYamlString(space.name)}`, 'type: index', '---', '', `# ${space.name}`, ''].join('\n'), 'utf8');
    }
    await appendIncrementalLinks(stageDir, links);
    return addedFiles;
  }

  private async publish(stageDir: string, liveDir: string): Promise<void> {
    await fs.mkdir(path.dirname(liveDir), { recursive: true });
    const oldDir = `${liveDir}.old-${Date.now()}`;
    await fs.rm(oldDir, { recursive: true, force: true }).catch((): undefined => undefined);
    try {
      await fs.rename(liveDir, oldDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    try {
      await fs.rename(stageDir, liveDir);
    } catch (err) {
      if (await pathExists(oldDir)) {
        await fs.rename(oldDir, liveDir).catch((): undefined => undefined);
      }
      throw err;
    }
    await fs.rm(oldDir, { recursive: true, force: true }).catch((): undefined => undefined);
  }
}

async function hasValidWikiOutput(stageDir: string): Promise<boolean> {
  const status = await inspectWikiOutput(stageDir);
  if (!status.hasIndex || status.existingChunkCount === 0) return false;
  if (status.missingLinkedChunks.length > 0) {
    throw new Error(`wiki output references missing chunk files: ${status.missingLinkedChunks.join(', ')}`);
  }
  return true;
}

async function waitForScodeWikiOutput(stageDir: string, jobId: string, startedAt = Date.now(), signal?: AbortSignal): Promise<void> {
  const db = getDatabase();
  let lastProgress = 25;
  let lastIdleUpdateAt = 0;
  while (Date.now() - startedAt < BUILD_TIMEOUT_MS) {
    if (signal?.aborted) return;
    const status = await inspectWikiOutput(stageDir);
    if (status.hasIndex || status.existingChunkCount > 0) {
      const progress = Math.max(lastProgress, Math.min(75, 25 + Math.round(status.completionRatio * 50)));
      lastProgress = progress;
      const chunkText = status.expectedChunkCount > 0 ? `${status.existingChunkCount}/${status.expectedChunkCount}` : `${status.existingChunkCount}`;
      db.updateLocalKbBuildJob(jobId, {
        progress,
        currentStep: `调用本地 scode 构建 Wiki（已生成 ${chunkText} 个 chunk，最后输出 ${formatElapsed(status.latestOutputMtimeMs)}）`,
      });
    } else if (Date.now() - lastIdleUpdateAt >= 10_000) {
      lastIdleUpdateAt = Date.now();
      db.updateLocalKbBuildJob(jobId, {
        progress: lastProgress,
        currentStep: `调用本地 scode 构建 Wiki（等待首个输出 ${formatElapsed(startedAt)}）`,
      });
    }

    if (status.isComplete) {
      await delay(SCODE_OUTPUT_SETTLE_MS);
      if (signal?.aborted) return;
      const settledStatus = await inspectWikiOutput(stageDir);
      if (settledStatus.isComplete) return;
    }

    await delay(SCODE_OUTPUT_POLL_INTERVAL_MS);
  }
  throw new Error('scode wiki build timed out');
}

async function inspectWikiOutput(stageDir: string): Promise<IWikiOutputStatus> {
  const indexPath = path.join(stageDir, LOCAL_KB_SPACE_INDEX_FILE);
  const hasIndex = await pathExists(indexPath);
  const entries = await fs.readdir(stageDir, { withFileTypes: true }).catch((): Dirent[] => []);
  const chunkFiles = entries.filter((entry) => entry.isFile() && /^chunk-\d+-.+\.md$/i.test(entry.name)).map((entry) => entry.name);
  const chunkSet = new Set(chunkFiles);
  const linkedChunks = hasIndex ? extractLinkedChunkFiles(await fs.readFile(indexPath, 'utf8').catch((): string => '')) : [];
  const missingLinkedChunks = linkedChunks.filter((file) => !chunkSet.has(file));
  const expectedChunkCount = linkedChunks.length;
  const existingChunkCount = chunkFiles.length;
  const latestOutputMtimeMs = await getLatestOutputMtimeMs(stageDir, [LOCAL_KB_SPACE_INDEX_FILE, ...chunkFiles]);
  const hasValidOutput = hasIndex && existingChunkCount > 0;
  const isComplete = hasValidOutput && missingLinkedChunks.length === 0 && (expectedChunkCount > 0 || Date.now() - latestOutputMtimeMs >= SCODE_OUTPUT_IDLE_COMPLETE_MS);
  return {
    hasIndex,
    existingChunkCount,
    expectedChunkCount,
    missingLinkedChunks,
    completionRatio: expectedChunkCount > 0 ? Math.min(1, existingChunkCount / expectedChunkCount) : existingChunkCount > 0 ? 0.5 : 0,
    latestOutputMtimeMs,
    isComplete,
  };
}

function extractLinkedChunkFiles(content: string): string[] {
  const out = new Set<string>();
  const patterns = [/\((?:\.\/)?(chunk-\d+-.+?\.md)(?:#[^)]+)?\)/gi, /\b(chunk-\d+-[^\s)]+\.md)\b/gi];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const file = match[1]?.trim();
      if (file) out.add(file);
    }
  }
  return [...out];
}

async function getLatestOutputMtimeMs(stageDir: string, files: string[]): Promise<number> {
  const mtimes = await Promise.all(files.map(async (file) => (await fs.stat(path.join(stageDir, file)).catch((): null => null))?.mtimeMs ?? 0));
  return Math.max(0, ...mtimes);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

function formatElapsed(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function writeScodeDebugPrompt(stageDir: string, prompt: string, scodePath: string): Promise<void> {
  const body = [`# Sudowork Local KB Wiki Build Prompt`, ``, `scode: ${scodePath}`, `stage: ${stageDir}`, `createdAt: ${new Date().toISOString()}`, ``, `## Prompt`, ``, '```text', prompt, '```', ''].join('\n');
  await fs.writeFile(path.join(stageDir, LOCAL_KB_DEBUG_PROMPT_FILE), body, 'utf8').catch((): undefined => undefined);
}

async function copyIncrementalDebugFiles(incrementalDir: string, stageDir: string): Promise<void> {
  await Promise.all(
    [
      [LOCAL_KB_DEBUG_PROMPT_FILE, '_sudowork_debug_incremental_prompt.md'],
      [LOCAL_KB_DEBUG_EVENTS_FILE, '_sudowork_debug_incremental_events.jsonl'],
      [LOCAL_KB_DEBUG_RESPONSE_FILE, '_sudowork_debug_incremental_response.md'],
    ].map(async ([source, target]) => {
      await fs.copyFile(path.join(incrementalDir, source), path.join(stageDir, target)).catch((): undefined => undefined);
    })
  );
}

async function appendIncrementalLinks(stageDir: string, links: Array<{ title: string; file: string }>): Promise<void> {
  if (links.length === 0) return;
  const indexPath = path.join(stageDir, LOCAL_KB_SPACE_INDEX_FILE);
  const existing = await fs.readFile(indexPath, 'utf8');
  const section = ['', `## 增量更新 ${new Date().toLocaleString()}`, '', ...links.map((link) => `- [${link.title}](./${link.file})`), ''].join('\n');
  await fs.writeFile(indexPath, `${existing.trimEnd()}\n${section}`, 'utf8');
}

function createScodeDebugRecorder(stageDir: string, startedAt: number): IScodeDebugRecorder {
  const eventsPath = path.join(stageDir, LOCAL_KB_DEBUG_EVENTS_FILE);
  const responsePath = path.join(stageDir, LOCAL_KB_DEBUG_RESPONSE_FILE);
  const appendEvent = (event: Record<string, unknown>) => {
    void fs
      .appendFile(
        eventsPath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          ...event,
        })}\n`,
        'utf8'
      )
      .catch((): undefined => undefined);
  };

  return {
    onSessionUpdate: (data: AcpSessionUpdate) => {
      const update = data.update;
      if (!update) return;
      if (update.sessionUpdate === 'agent_message_chunk') {
        const text = update.content.type === 'text' ? update.content.text || '' : `[image:${update.content.mimeType || 'unknown'}]`;
        appendEvent({ type: update.sessionUpdate, text });
        if (text) void fs.appendFile(responsePath, text, 'utf8').catch((): undefined => undefined);
        return;
      }
      if (update.sessionUpdate === 'agent_thought_chunk') {
        appendEvent({ type: update.sessionUpdate, text: update.content.text });
        return;
      }
      if (update.sessionUpdate === 'tool_call') {
        appendEvent({
          type: update.sessionUpdate,
          toolCallId: update.toolCallId,
          status: update.status,
          title: update.title,
          kind: update.kind,
          rawInput: update.rawInput,
          locations: update.locations,
        });
        return;
      }
      if (update.sessionUpdate === 'tool_call_update') {
        appendEvent({
          type: update.sessionUpdate,
          toolCallId: update.toolCallId,
          status: update.status,
          rawInput: update.rawInput,
          content: update.content,
        });
        return;
      }
      appendEvent({ type: update.sessionUpdate });
    },
    onPromptUsage: (usage: AcpPromptResponseUsage) => appendEvent({ type: 'prompt_usage', usage }),
    onEndTurn: () => appendEvent({ type: 'end_turn' }),
    recordError: async (err: unknown) => {
      appendEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    },
  };
}

interface IWikiOutputStatus {
  hasIndex: boolean;
  existingChunkCount: number;
  expectedChunkCount: number;
  missingLinkedChunks: string[];
  completionRatio: number;
  latestOutputMtimeMs: number;
  isComplete: boolean;
}

interface IScodeDebugRecorder {
  onSessionUpdate: (data: AcpSessionUpdate) => void;
  onPromptUsage: (usage: AcpPromptResponseUsage) => void;
  onEndTurn: () => void;
  recordError: (err: unknown) => Promise<void>;
}

function buildWikiBuilderPrompt(space: ILocalKbSpace, mode: 'full' | 'incremental'): string {
  const modeInstruction =
    mode === 'incremental' ? `本次是增量构建：input/ 里只包含新增文档。只需要为这些新增文档生成临时 ${LOCAL_KB_SPACE_INDEX_FILE} 和 chunk 文件；不要关心旧知识库内容，外层程序会负责合并。` : `本次是全量构建：input/ 里包含该知识库全部文档。请生成完整 ${LOCAL_KB_SPACE_INDEX_FILE} 和全部 chunk 文件。`;
  return `你是 Sudowork 本地知识库构建助手。请读取当前工作目录 input/ 下的所有 markdown 文档，生成结构化本地知识库。

${modeInstruction}

输出必须写在当前工作目录根目录：
- ${LOCAL_KB_SPACE_INDEX_FILE}
- chunk-001-<topic>.md, chunk-002-<topic>.md ...
- 如有图片，可写 _sudowork_images.md 并复制 images/

要求：
1. ${LOCAL_KB_SPACE_INDEX_FILE} 必须包含 YAML frontmatter:
---
title: ${space.name}
type: index
---
2. 每个 chunk 必须包含 YAML frontmatter:
---
title: 人类可读标题
type: chunk
topic: topic-slug
---
3. 按主题、流程、FAQ、术语、异常处理等语义切分，不要简单按字数机械切。
4. 不要编造原文没有的信息。
5. 单个 chunk 尽量不超过 5000 字。
6. 如果 input/ 总文本少于 20000 字，最多生成 1-3 个 chunk；不要为了小文档拆出很多 chunk。
7. 优先一次性完成：先读 input/ 文件列表和内容，然后一次性写出 ${LOCAL_KB_SPACE_INDEX_FILE} 与全部 chunk；不要每写一个 chunk 就停下来等待下一轮。
8. chunk 编号必须连续，从 chunk-001 开始，不要跳号，不要写完后再重命名。
9. 完成后只需简短说明已构建。

请开始构建。`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function escapeYamlString(value: string): string {
  return JSON.stringify(value).replace(/^"|"$/g, '');
}

function splitIncrementalContent(markdown: string, maxChars = 5_000): string[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [''];
  if (trimmed.length <= maxChars) return [trimmed];
  const paragraphs = trimmed.split(/\n{2,}/);
  const parts: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) parts.push(current);
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }
    for (let i = 0; i < paragraph.length; i += maxChars) {
      parts.push(paragraph.slice(i, i + maxChars));
    }
    current = '';
  }
  if (current) parts.push(current);
  return parts;
}

export const localKnowledgeBuildExecutor = new LocalKnowledgeBuildExecutor();
