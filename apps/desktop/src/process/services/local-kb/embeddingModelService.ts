import fs from 'fs/promises';
import fsSync from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { COS_LEGACY_HUB_BASE, COS_RUNTIME_BASE } from '@sudowork/common/cos';
import type { ILocalKbInstallEmbeddingModelInput, LocalKbInstallPhase } from '@/common/types/localKnowledgeBase';
import { extractZipWithProgress } from '@process/services/archiveProgress';
import { getLocalKbModelsDir, getLocalKbRootDir } from './paths';

export const LOCAL_KB_EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';

export type LocalKbInstallProgressCallback = (phase: LocalKbInstallPhase, percent?: number) => void;

const MODEL_ARCHIVE_NAME = 'Xenova.zip';
const REQUIRED_MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'] as const;

export class LocalKbEmbeddingModelService {
  private installPromise: Promise<void> | null = null;

  getModelId(): string {
    return LOCAL_KB_EMBEDDING_MODEL_ID;
  }

  getModelDir(): string {
    return path.join(getLocalKbModelsDir(), LOCAL_KB_EMBEDDING_MODEL_ID);
  }

  getModelOnnxPath(): string {
    return path.join(this.getModelDir(), 'onnx', 'model_quantized.onnx');
  }

  checkInstalled(): boolean {
    return hasRequiredModelFiles(this.getModelDir());
  }

  async install(onProgress: LocalKbInstallProgressCallback, options?: ILocalKbInstallEmbeddingModelInput): Promise<void> {
    if (this.installPromise) return this.installPromise;
    this.installPromise = this.installInternal(onProgress, options).finally(() => {
      this.installPromise = null;
    });
    return this.installPromise;
  }

  private async installInternal(onProgress: LocalKbInstallProgressCallback, options?: ILocalKbInstallEmbeddingModelInput): Promise<void> {
    if (this.checkInstalled()) {
      onProgress('verifying', 100);
      return;
    }

    const archivePath = await this.resolveArchivePath(onProgress, options);
    const stageDir = path.join(getLocalKbRootDir(), '.stage', `embedding-model-${Date.now()}`);
    try {
      await fs.rm(stageDir, { recursive: true, force: true });
      await fs.mkdir(stageDir, { recursive: true });
      onProgress('extracting', 0);
      await extractZipWithProgress(archivePath, stageDir, (percent) => onProgress('extracting', percent));

      onProgress('verifying', 0);
      const extractedModelDir = await findModelDir(stageDir);
      if (!extractedModelDir) {
        throw new Error(`embedding model archive does not contain required files: ${REQUIRED_MODEL_FILES.join(', ')}`);
      }

      const targetDir = this.getModelDir();
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.rm(targetDir, { recursive: true, force: true });
      await copyModelDir(extractedModelDir, targetDir);
      if (!this.checkInstalled()) {
        throw new Error('embedding model install verification failed');
      }
      onProgress('verifying', 100);
    } catch (err) {
      await fs.rm(archivePath, { force: true }).catch((): undefined => undefined);
      throw err;
    } finally {
      onProgress('cleanup');
      await fs.rm(stageDir, { recursive: true, force: true }).catch((): undefined => undefined);
    }
  }

  private async resolveArchivePath(onProgress: LocalKbInstallProgressCallback, options?: ILocalKbInstallEmbeddingModelInput): Promise<string> {
    const downloadUrl = options?.downloadUrl?.trim() || process.env.SUDOWORK_LOCAL_KB_EMBEDDING_MODEL_URL?.trim();
    const cachePath = this.getCachePath(downloadUrl);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    if (!fsSync.existsSync(cachePath) || fsSync.statSync(cachePath).size === 0) {
      await this.downloadWithFallback(this.getDownloadUrls(downloadUrl), cachePath, (percent) => onProgress('downloading', percent));
    } else {
      onProgress('downloading', 100);
    }
    return cachePath;
  }

  private getDownloadUrls(downloadUrl?: string): string[] {
    const urls = [`${COS_RUNTIME_BASE}/model/${MODEL_ARCHIVE_NAME}`, `${COS_LEGACY_HUB_BASE}/sudowork/model/${MODEL_ARCHIVE_NAME}`];
    const normalizedUrl = downloadUrl?.trim();
    return normalizedUrl ? [normalizedUrl, ...urls] : urls;
  }

  private getCachePath(downloadUrl?: string): string {
    const fileName = getArchiveFileName(downloadUrl);
    return path.join(getLocalKbRootDir(), 'cache', fileName);
  }

  private async downloadWithFallback(urls: string[], destPath: string, onProgress: (percent: number) => void): Promise<void> {
    let lastError: unknown;
    for (const url of urls) {
      try {
        await downloadFile(url, destPath, onProgress);
        return;
      } catch (err) {
        lastError = err;
        await fs.rm(destPath, { force: true }).catch((): undefined => undefined);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('embedding model download failed');
  }
}

async function findModelDir(root: string): Promise<string | null> {
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (hasRequiredModelFiles(dir)) {
      return dir;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((): fsSync.Dirent[] => []);
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(path.join(dir, entry.name));
    }
  }
  return null;
}

async function copyModelDir(sourceDir: string, targetDir: string): Promise<void> {
  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return name !== '.DS_Store' && name !== '__MACOSX' && name !== '.cache';
    },
  });
}

function hasRequiredModelFiles(modelDir: string): boolean {
  return REQUIRED_MODEL_FILES.every((relativePath) => fsSync.existsSync(path.join(modelDir, relativePath)));
}

function getArchiveFileName(downloadUrl?: string): string {
  if (!downloadUrl?.trim()) return MODEL_ARCHIVE_NAME;
  try {
    const url = new URL(downloadUrl);
    const baseName = path.basename(url.pathname);
    if (baseName.endsWith('.zip')) return `custom-${baseName}`;
  } catch {
    // Use the default cache name for malformed URLs; download will fail later with a clear error.
  }
  return MODEL_ARCHIVE_NAME;
}

async function downloadFile(url: string, destPath: string, onProgress: (percent: number) => void): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    let redirects = 0;
    const request = (currentUrl: string): void => {
      if (redirects > 8) {
        reject(new Error('too many redirects'));
        return;
      }
      const client = currentUrl.startsWith('https:') ? https : http;
      const req = client.get(currentUrl, (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 307, 308].includes(status) && response.headers.location) {
          redirects += 1;
          response.resume();
          request(new URL(response.headers.location, currentUrl).toString());
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`download failed with HTTP ${status}`));
          return;
        }

        const total = Number(response.headers['content-length'] ?? 0);
        let downloaded = 0;
        const file = fsSync.createWriteStream(destPath);
        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (total > 0) onProgress(Math.round((downloaded / total) * 100));
        });
        response.pipe(file);
        response.on('error', reject);
        file.on('finish', () => {
          file.close(() => {
            onProgress(100);
            resolve();
          });
        });
        file.on('error', (err) => {
          file.close(() => {
            fsSync.rmSync(destPath, { force: true });
            reject(err);
          });
        });
      });
      req.on('error', reject);
      req.setTimeout(120_000, () => {
        req.destroy(new Error('download timed out'));
      });
    };
    request(url);
  });
}

export const localKbEmbeddingModelService = new LocalKbEmbeddingModelService();
