/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';
import * as yauzl from 'yauzl';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type ArchiveProgressCallback = (percent: number) => void;

function createProgressReporter(onProgress?: ArchiveProgressCallback): (processed: number, total: number) => void {
  let lastPercent = -1;
  return (processed: number, total: number) => {
    if (!onProgress || total <= 0) return;
    const percent = Math.max(0, Math.min(100, Math.floor((processed / total) * 100)));
    if (percent === lastPercent) return;
    lastPercent = percent;
    onProgress(percent);
  };
}

/**
 * Check if Windows native tar.exe is available (Windows 10 1803+).
 */
async function isNativeTarAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    await execFileAsync('tar', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function extractTarGzWithProgress(archivePath: string, targetDir: string, onProgress?: ArchiveProgressCallback, options?: { strip?: number }): Promise<void> {
  const totalBytes = fs.statSync(archivePath).size;
  const reportProgress = createProgressReporter(onProgress);
  const strip = options?.strip ?? 0;

  reportProgress(0, totalBytes);

  // On Windows, prefer native tar.exe for better performance (2-5x faster than Node.js tar)
  if (await isNativeTarAvailable()) {
    const args = ['-xzf', archivePath, '-C', targetDir];
    if (strip > 0) args.push(`--strip-components=${strip}`);
    await execFileAsync('tar', args);
    reportProgress(totalBytes, totalBytes);
    return;
  }

  // Fallback: Node.js tar with optimized buffer sizes (1MB chunk size for better throughput)
  const BUFFER_SIZE = 1024 * 1024; // 1MB
  let processedBytes = 0;

  const readStream = fs.createReadStream(archivePath, { highWaterMark: BUFFER_SIZE });
  readStream.on('data', (chunk: Buffer) => {
    processedBytes += chunk.length;
    reportProgress(processedBytes, totalBytes);
  });

  await pipeline(readStream, zlib.createGunzip({ chunkSize: BUFFER_SIZE }), tar.x({ cwd: targetDir, strip }));
  reportProgress(totalBytes, totalBytes);
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { autoClose: false, lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error(`Failed to open zip archive: ${zipPath}`));
        return;
      }
      resolve(zipFile);
    });
  });
}

type ZipEntryRecord = {
  fileName: string;
  compressedSize: number;
  isDirectory: boolean;
  entry: yauzl.Entry;
};

async function collectZipEntries(zipPath: string): Promise<{ zipFile: yauzl.ZipFile; entries: ZipEntryRecord[]; totalCompressedSize: number }> {
  const zipFile = await openZip(zipPath);

  return new Promise((resolve, reject) => {
    const entries: ZipEntryRecord[] = [];
    let totalCompressedSize = 0;

    zipFile.on('entry', (entry) => {
      const isDirectory = /\/$/.test(entry.fileName);
      const compressedSize = entry.compressedSize ?? 0;
      entries.push({
        fileName: entry.fileName,
        compressedSize,
        isDirectory,
        entry,
      });
      if (!isDirectory) {
        totalCompressedSize += compressedSize;
      }
      zipFile.readEntry();
    });

    zipFile.once('end', () => {
      resolve({ zipFile, entries, totalCompressedSize });
    });

    zipFile.once('error', reject);
    zipFile.readEntry();
  });
}

/**
 * List all entry paths in a .tar.gz archive without extracting.
 */
export async function listTarGzEntries(archivePath: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.t({
    file: archivePath,
    onReadEntry: (entry: tar.ReadEntry) => {
      entries.push(entry.path);
    },
  });
  return entries;
}

/**
 * List all entry paths in a .zip archive without extracting.
 */
export async function listZipEntries(zipPath: string): Promise<string[]> {
  const { zipFile, entries } = await collectZipEntries(zipPath);
  zipFile.close();
  return entries.map((e) => e.fileName);
}

function openZipReadStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<fs.ReadStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(`Failed to open zip entry stream: ${entry.fileName}`));
        return;
      }
      resolve(stream as fs.ReadStream);
    });
  });
}

/**
 * Strip leading path components from a zip entry filename.
 * e.g. strip=1: "dir/sub/file.txt" → "sub/file.txt", "dir/" → ""
 */
function stripZipEntryPath(fileName: string, strip: number): string {
  if (strip <= 0) return fileName;
  const parts = fileName.split('/');
  // If the original entry ends with '/', it's a directory – preserve that
  const isDir = fileName.endsWith('/');
  const stripped = parts.slice(strip);
  if (stripped.length === 0 || (stripped.length === 1 && stripped[0] === '')) return '';
  return stripped.join('/') + (isDir && !stripped[stripped.length - 1].endsWith('/') ? '' : '');
}

export async function extractZipWithProgress(zipPath: string, targetDir: string, onProgress?: ArchiveProgressCallback, options?: { strip?: number }): Promise<void> {
  const { zipFile, entries, totalCompressedSize } = await collectZipEntries(zipPath);
  const reportProgress = createProgressReporter(onProgress);
  const strip = options?.strip ?? 0;
  let processedCompressedSize = 0;

  reportProgress(0, totalCompressedSize || 1);

  try {
    for (const item of entries) {
      const strippedName = strip > 0 ? stripZipEntryPath(item.fileName, strip) : item.fileName;

      // Skip entries that are fully stripped away (e.g. the top-level dir itself)
      if (!strippedName) {
        processedCompressedSize += item.compressedSize;
        reportProgress(processedCompressedSize, totalCompressedSize || processedCompressedSize || 1);
        continue;
      }

      const targetPath = path.join(targetDir, strippedName);

      if (item.isDirectory) {
        fs.mkdirSync(targetPath, { recursive: true });
        continue;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const readStream = await openZipReadStream(zipFile, item.entry);
      const writeStream = fs.createWriteStream(targetPath);

      let entryProcessed = 0;
      readStream.on('data', (chunk: Buffer) => {
        entryProcessed += chunk.length;
        const estimatedCompressedProcessed = processedCompressedSize + Math.min(entryProcessed, item.compressedSize || entryProcessed);
        reportProgress(estimatedCompressedProcessed, totalCompressedSize || estimatedCompressedProcessed || 1);
      });

      await pipeline(readStream, writeStream);
      processedCompressedSize += item.compressedSize;
      reportProgress(processedCompressedSize, totalCompressedSize || processedCompressedSize || 1);
    }
  } finally {
    zipFile.close();
  }

  reportProgress(totalCompressedSize || 1, totalCompressedSize || 1);
}
