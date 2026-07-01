/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { NEXUS_TIMESTAMP_SEPARATOR } from '@/common/constants';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import https from 'node:https';
import http from 'node:http';
import { app } from 'electron';
import JSZip from 'jszip';
import { ipcBridge } from '../../common';
import { getSystemDir, getAssistantsDir, getSkillsDir, getHubAssistantsDir, getSystemAssistantsDir, getCustomAssistantsDir } from '../initStorage';
import { ASSISTANT_SUBDIRS, ENTERPRISE_ASSISTANT_SUBDIRS, ASSISTANT_META_FILE } from '../constants/assistantStorage';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { readDirectoryRecursive } from '../utils';
import { scanWorkspaceSkills } from '../utils/scanWorkspaceSkills';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

// CrashReporter imports for breadcrumb tracking
import { fileBreadcrumbs } from '../telemetry/BreadcrumbTracker';

// ============================================================================
// Helper functions for builtin resource directory resolution
// 内置资源目录解析辅助函数
// ============================================================================

type ResourceType = 'rules' | 'skills';

/**
 * Find the builtin resource directory (rules or skills)
 * 查找内置资源目录（rules 或 skills）
 *
 * When packaged, resources are in asarUnpack, so they're at app.asar.unpacked/
 * 打包后，资源在 asarUnpack 中，所以在 app.asar.unpacked/ 目录下
 */
async function findBuiltinResourceDir(resourceType: ResourceType): Promise<string> {
  if (app.isPackaged) {
    const appPath = app.getAppPath();
    // asarUnpack extracts files to app.asar.unpacked directory
    // asarUnpack 会将文件解压到 app.asar.unpacked 目录
    const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
    const candidates = [
      path.join(unpackedPath, resourceType), // Unpacked location (preferred)
      path.join(appPath, resourceType), // Fallback to asar path
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try next path
      }
    }
    mainWarn('fsBridge', `Could not find builtin ${resourceType} directory, tried:`, candidates);
    return candidates[0]; // Default to unpacked path
  }
  // Development: try multiple paths
  const appPath = app.getAppPath();
  const candidates = [path.join(appPath, resourceType), path.join(appPath, '..', resourceType), path.join(appPath, '..', '..', resourceType), path.join(appPath, '..', '..', '..', resourceType)];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next path
    }
  }
  return candidates[0]; // Default fallback
}

/**
 * Get user config skills directory
 * 获取用户配置 skills 目录
 */
function getUserSkillsDir(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'config', 'skills');
}

/**
 * Copy directory recursively
 * 递归复制目录
 */
async function copyDirectory(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Read a builtin resource file (.md only)
 * 读取内置资源文件（仅限 .md）
 */
async function readBuiltinResource(resourceType: ResourceType, fileName: string): Promise<string> {
  const safeFileName = path.basename(fileName);
  if (!safeFileName.endsWith('.md')) {
    throw new Error('Only .md files are allowed');
  }
  const dir = await findBuiltinResourceDir(resourceType);
  return fs.readFile(path.join(dir, safeFileName), 'utf-8');
}

/**
 * Read assistant resource file with locale fallback
 * 读取助手资源文件，支持语言回退
 *
 * Directory structure:
 * Enterprise mode: hub/{name}, system/{name}, custom/{id}
 * Personal mode: _hub/{name}, _system/{name}, _my-custom-assistant/{id}
 */
async function readAssistantResource(resourceType: ResourceType, assistantId: string, locale: string, fileNamePattern: (id: string, loc: string) => string): Promise<string> {
  const assistantsDir = getAssistantsDir();
  const locales = [locale, 'en-US', 'zh-CN'].filter((l, i, arr) => arr.indexOf(l) === i);

  // 1. Try new directory structure (hub, system, custom) - mode-aware
  const subdirs = isEnterpriseMode() ? [ENTERPRISE_ASSISTANT_SUBDIRS.hub, ENTERPRISE_ASSISTANT_SUBDIRS.system, ENTERPRISE_ASSISTANT_SUBDIRS.custom] : [ASSISTANT_SUBDIRS.hub, ASSISTANT_SUBDIRS.system, ASSISTANT_SUBDIRS.custom];
  for (const subdir of subdirs) {
    const assistantDir = path.join(assistantsDir, subdir, assistantId);
    try {
      // Check if directory exists
      await fs.access(assistantDir);

      // Read _sudowork_meta.json to get ruleFile
      let ruleFile: string | undefined = undefined;
      try {
        const metaRaw = await fs.readFile(path.join(assistantDir, ASSISTANT_META_FILE), 'utf-8');
        const meta = JSON.parse(metaRaw) as { ruleFile?: string };
        ruleFile = meta.ruleFile;
      } catch {
        // No meta file, will scan for .md files
      }

      // If ruleFile is specified, try locale variants first
      if (ruleFile) {
        const ruleFileBase = ruleFile.replace('.md', '');
        for (const loc of locales) {
          const localeFile = `${ruleFileBase}.${loc}.md`;
          try {
            return await fs.readFile(path.join(assistantDir, localeFile), 'utf-8');
          } catch {
            // Try next locale
          }
        }
        // Fallback to ruleFile itself
        try {
          return await fs.readFile(path.join(assistantDir, ruleFile), 'utf-8');
        } catch {
          // Fall through to scan
        }
      }

      // No ruleFile or not found - scan for any .md file
      try {
        const files = await fs.readdir(assistantDir);
        const mdFiles = files.filter((f) => f.endsWith('.md') && !f.endsWith('-skills.md'));
        if (mdFiles.length > 0) {
          // Priority: {assistantId}.md > any .md file
          const primaryFile = mdFiles.find((f) => f === `${assistantId}.md`);
          const targetFile = primaryFile || mdFiles[0];
          return await fs.readFile(path.join(assistantDir, targetFile), 'utf-8');
        }
      } catch {
        // No .md files found
      }
    } catch {
      // Directory doesn't exist, try next
    }
  }

  // 2. Try user data directory (legacy flat structure)
  for (const loc of locales) {
    const fileName = fileNamePattern(assistantId, loc);
    try {
      return await fs.readFile(path.join(assistantsDir, fileName), 'utf-8');
    } catch {
      // Try next locale
    }
  }

  // 3. Fallback to builtin directory
  const builtinDir = await findBuiltinResourceDir(resourceType);
  for (const loc of locales) {
    const fileName = fileNamePattern(assistantId, loc);
    try {
      const content = await fs.readFile(path.join(builtinDir, fileName), 'utf-8');
      return content;
    } catch {
      // Try next locale
    }
  }

  return ''; // Not found
}

/**
 * Write assistant resource file to user directory
 * 写入助手资源文件到用户目录
 *
 * Directory structure:
 * Enterprise mode: custom/{id}/AGENT.md
 * Personal mode: _my-custom-assistant/{id}/AGENT.md
 */
async function writeAssistantResource(resourceType: ResourceType, assistantId: string, content: string, locale: string, fileNamePattern: (id: string, loc: string) => string): Promise<boolean> {
  try {
    const assistantsDir = getAssistantsDir();

    // Check if the assistant directory exists in any of the new subdirs (hub, system, custom).
    // This ensures writes go to the same location that readAssistantResource() reads from,
    // preventing a read/write path mismatch where edits would be silently lost.
    const subdirs = isEnterpriseMode() ? [ENTERPRISE_ASSISTANT_SUBDIRS.custom, ENTERPRISE_ASSISTANT_SUBDIRS.hub, ENTERPRISE_ASSISTANT_SUBDIRS.system] : [ASSISTANT_SUBDIRS.custom, ASSISTANT_SUBDIRS.hub, ASSISTANT_SUBDIRS.system];
    for (const subdir of subdirs) {
      const assistantDir = path.join(assistantsDir, subdir, assistantId);
      try {
        await fs.access(assistantDir);
        // Directory exists — write AGENT.md here
        await fs.writeFile(path.join(assistantDir, 'AGENT.md'), content, 'utf-8');
        return true;
      } catch {
        // Directory doesn't exist in this subdir, try next
      }
    }

    // For other assistants, use legacy flat structure
    await fs.mkdir(assistantsDir, { recursive: true });
    const fileName = fileNamePattern(assistantId, locale);
    await fs.writeFile(path.join(assistantsDir, fileName), content, 'utf-8');
    return true;
  } catch (error) {
    mainError('fsBridge', `Failed to write assistant ${resourceType}:`, error);
    return false;
  }
}

/**
 * Delete assistant resource files (all locale versions)
 * 删除助手资源文件（所有语言版本）
 */
async function deleteAssistantResource(resourceType: ResourceType, filePattern: RegExp): Promise<boolean> {
  try {
    const assistantsDir = getAssistantsDir();
    const files = await fs.readdir(assistantsDir);
    for (const file of files) {
      if (filePattern.test(file)) {
        await fs.unlink(path.join(assistantsDir, file));
      }
    }
    return true;
  } catch (error) {
    mainError('fsBridge', `Failed to delete assistant ${resourceType}:`, error);
    return false;
  }
}

// File name patterns for rules and skills
const ruleFilePattern = (id: string, loc: string) => `${id}.${loc}.md`;
const skillFilePattern = (id: string, loc: string) => `${id}-skills.${loc}.md`;

// 在文件顶部添加一个新的 Map 来跟踪每个目录的 AbortController
const directoryAbortControllers = new Map<string, AbortController>();
const FILE_SELECTOR_MAX_DEPTH = 10;

export function initFsBridge(): void {
  const canceledZipRequests = new Set<string>();

  ipcBridge.fs.listDir.provider(async ({ dir }) => {
    try {
      const items = await fs.readdir(dir);
      return items;
    } catch {
      return [];
    }
  });

  ipcBridge.fs.getFilesByDir.provider(async ({ dir }) => {
    // 检查是否已有正在进行的相同目录请求，如果有则取消它
    if (directoryAbortControllers.has(dir)) {
      const previousController = directoryAbortControllers.get(dir);
      previousController?.abort();
    }

    const abortController = new AbortController();
    directoryAbortControllers.set(dir, abortController);

    try {
      const tree = await readDirectoryRecursive(dir, {
        abortController,
        maxDepth: FILE_SELECTOR_MAX_DEPTH,
      });

      // 请求完成后清理 abort controller
      directoryAbortControllers.delete(dir);

      return tree ? [tree] : [];
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Directory read was aborted, return empty array
      } else {
        mainError('fsBridge', 'Error reading directory', { dir, error });
      }
      directoryAbortControllers.delete(dir);
      return []; // Return empty array on error instead of throwing
    }
  });

  ipcBridge.fs.getImageBase64.provider(async ({ path: filePath }) => {
    try {
      const ext = (path.extname(filePath) || '').toLowerCase().replace(/^\./, '');
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        tif: 'image/tiff',
        tiff: 'image/tiff',
        avif: 'image/avif',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';
      const base64 = await fs.readFile(filePath, { encoding: 'base64' });
      return `data:${mime};base64,${base64}`;
    } catch (error) {
      mainWarn('fsBridge', 'getImageBase64 failed', { path: filePath, error: String(error) });
      // Return a placeholder data URL instead of throwing
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIG5vdCBmb3VuZDwvdGV4dD48L3N2Zz4=';
    }
  });

  // 下载远程图片并限制协议/重定向次数 / Download remote resource with protocol & redirect guard
  const downloadRemoteBuffer = (targetUrl: string, redirectCount = 0): Promise<{ buffer: Buffer; contentType?: string }> => {
    const allowedProtocols = new Set(['http:', 'https:']);
    const parsedUrl = new URL(targetUrl);
    if (!allowedProtocols.has(parsedUrl.protocol)) {
      return Promise.reject(new Error('Unsupported protocol'));
    }

    return new Promise((resolve, reject) => {
      try {
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const request = client.get(
          targetUrl,
          {
            headers: {
              'User-Agent': 'Sudowork-Preview',
              Referer: 'https://github.com/sudoprivacy/Sudowork',
            },
          },
          (response) => {
            const { statusCode = 0, headers } = response;

            if (statusCode >= 300 && statusCode < 400 && headers.location && redirectCount < 5) {
              const redirectUrl = new URL(headers.location, targetUrl).toString();
              response.resume();
              resolve(downloadRemoteBuffer(redirectUrl, redirectCount + 1));
              return;
            }

            if (statusCode >= 400) {
              response.resume();
              reject(new Error(`Failed to fetch image: HTTP ${statusCode}`));
              return;
            }

            const chunks: Buffer[] = [];
            let receivedBytes = 0;
            const MAX_BYTES = 5 * 1024 * 1024; // 5MB limit

            response.on('data', (chunk: Buffer) => {
              receivedBytes += chunk.length;
              if (receivedBytes > MAX_BYTES) {
                response.destroy(new Error('Remote image exceeds size limit (5MB)'));
                return;
              }
              chunks.push(chunk);
            });

            response.on('end', () => {
              resolve({ buffer: Buffer.concat(chunks), contentType: headers['content-type'] });
            });
            response.on('error', (error) => reject(error));
          }
        );

        request.setTimeout(15000, () => {
          request.destroy(new Error('Remote image request timed out'));
        });

        request.on('error', (error) => reject(error));
      } catch (error) {
        reject(error);
      }
    });
  };

  // 通过桥接层拉取远程图片并转成 base64 / Fetch remote image via bridge and return base64
  ipcBridge.fs.fetchRemoteImage.provider(async ({ url }) => {
    const { buffer, contentType } = await downloadRemoteBuffer(url);
    const base64 = buffer.toString('base64');
    return `data:${contentType || 'application/octet-stream'};base64,${base64}`;
  });

  // 创建临时文件 / Create temporary file on disk
  ipcBridge.fs.createTempFile.provider(async ({ fileName }) => {
    try {
      const { cacheDir } = getSystemDir();
      const tempDir = path.join(cacheDir, 'temp');

      // 确保临时目录存在 / Ensure temp directory exists
      await fs.mkdir(tempDir, { recursive: true });

      // 使用原文件名，必要时清理非法字符 / Keep original name but sanitize illegal characters
      const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
      let tempFilePath = path.join(tempDir, safeFileName);

      // 如果冲突则追加时间戳后缀 / Append timestamp when duplicate exists
      const fileExists = await fs
        .access(tempFilePath)
        .then(() => true)
        .catch(() => false);

      if (fileExists) {
        const timestamp = Date.now();
        const ext = path.extname(safeFileName);
        const name = path.basename(safeFileName, ext);
        const tempFileName = `${name}${NEXUS_TIMESTAMP_SEPARATOR}${timestamp}${ext}`;
        tempFilePath = path.join(tempDir, tempFileName);
      }

      // 创建空文件作为占位 / Create empty placeholder file
      await fs.writeFile(tempFilePath, Buffer.alloc(0));

      return tempFilePath;
    } catch (error) {
      mainError('fsBridge', 'Failed to create temp file:', error);
      throw error;
    }
  });

  // 读取文件内容（UTF-8编码）/ Read file content (UTF-8 encoding)
  ipcBridge.fs.readFile.provider(async ({ path: filePath }) => {
    try {
      // Breadcrumb: file read
      fileBreadcrumbs.read(filePath);

      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      // 文件不存在时静默返回空字符串，不打印错误、不抛出异常，避免影响正常任务流程
      // File not found: return empty string silently so callers can skip gracefully
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }

      // Breadcrumb: file read error
      fileBreadcrumbs.error('read', filePath, (error as Error).message);

      mainError('fsBridge', 'Failed to read file:', error);
      throw error;
    }
  });

  // 读取二进制文件为 ArrayBuffer / Read binary file as ArrayBuffer
  ipcBridge.fs.readFileBuffer.provider(async ({ path: filePath }) => {
    try {
      // Breadcrumb: file read (binary)
      fileBreadcrumbs.read(filePath);

      const buffer = await fs.readFile(filePath);
      // 将 Node.js Buffer 转换为 ArrayBuffer
      // Convert Node.js Buffer to ArrayBuffer
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (error) {
      // Breadcrumb: file read error
      fileBreadcrumbs.error('read', filePath, (error as Error).message);

      mainError('fsBridge', 'Failed to read file buffer:', error);
      throw error;
    }
  });

  // 读取二进制文件为 Base64 字符串（可安全通过 JSON 序列化的 IPC 传输）
  // Read binary file as Base64 string (safe for JSON-serialized IPC transport)
  ipcBridge.fs.readFileBase64.provider(async ({ path: filePath }) => {
    try {
      // Breadcrumb: file read (base64)
      fileBreadcrumbs.read(filePath);

      return await fs.readFile(filePath, { encoding: 'base64' });
    } catch (error) {
      // Breadcrumb: file read error
      fileBreadcrumbs.error('read', filePath, (error as Error).message);

      mainError('fsBridge', 'Failed to read file as base64:', error);
      throw error;
    }
  });

  // 写入文件
  ipcBridge.fs.writeFile.provider(async ({ path: filePath, data }) => {
    try {
      // Breadcrumb: file write
      const dataSize = typeof data === 'string' ? data.length : (data as Uint8Array)?.byteLength || 0;
      fileBreadcrumbs.write(filePath, dataSize);
      // 处理字符串类型 / Handle string type
      if (typeof data === 'string') {
        await fs.writeFile(filePath, data, 'utf-8');

        // 发送流式内容更新事件到预览面板（用于实时更新）
        // Send streaming content update to preview panel (for real-time updates)
        try {
          const pathSegments = filePath.split(path.sep);
          const fileName = pathSegments[pathSegments.length - 1];
          const workspace = pathSegments.slice(0, -1).join(path.sep);

          const eventData = {
            filePath: filePath,
            content: data,
            workspace: workspace,
            relativePath: fileName,
            operation: 'write' as const,
          };

          ipcBridge.fileStream.contentUpdate.emit(eventData);

          // When the agent writes an HTML file, also surface it in the right-panel
          // browser. The PreviewContext stops opening html in the floating
          // PreviewPanel (see PreviewContext.tsx) so this is the single visible
          // landing place. file:// URL allows the right-panel webview to load
          // the file directly without copying it elsewhere.
          if (/\.html?$/i.test(fileName)) {
            ipcBridge.rightPanelBrowser.open.emit({ url: `file://${filePath}`, switchTab: true });
          }
        } catch (emitError) {
          mainError('fsBridge', '❌ Failed to emit file stream update:', emitError);
        }

        return true;
      }

      // 处理 Uint8Array 在 IPC 传输中被序列化为对象的情况
      let bufferData;

      // 检查是否是被序列化的类型化数组（包含数字键的对象）
      if (data && typeof data === 'object' && data.constructor?.name === 'Object') {
        const keys = Object.keys(data);
        // 检查是否所有键都是数字字符串（类型化数组的特征）
        const isTypedArrayLike = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));

        if (isTypedArrayLike) {
          // 确保值是数字数组
          const values = Object.values(data).map((v) => (typeof v === 'number' ? v : parseInt(v, 10)));
          bufferData = Buffer.from(values);
        } else {
          bufferData = data;
        }
      } else if (data instanceof Uint8Array) {
        bufferData = Buffer.from(data);
      } else if (Buffer.isBuffer(data)) {
        bufferData = data;
      } else {
        bufferData = data;
      }

      await fs.writeFile(filePath, bufferData);
      return true;
    } catch (error) {
      // Breadcrumb: file write error
      fileBreadcrumbs.error('write', filePath, (error as Error).message);

      mainError('fsBridge', 'Failed to write file:', error);
      return false;
    }
  });

  // 创建目录
  ipcBridge.fs.createDir.provider(async ({ path: dirPath }) => {
    try {
      // Breadcrumb: directory created
      fileBreadcrumbs.createDir(dirPath);

      await fs.mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      // Breadcrumb: directory create error
      fileBreadcrumbs.error('create_dir', dirPath, (error as Error).message);

      mainError('fsBridge', 'Failed to create directory:', error);
      return false;
    }
  });

  ipcBridge.fs.cancelZip.provider(async ({ requestId }) => {
    if (!requestId) return false;
    canceledZipRequests.add(requestId);
    return true;
  });

  ipcBridge.fs.createZip.provider(async ({ path: filePath, files, requestId }) => {
    const isCanceled = () => Boolean(requestId && canceledZipRequests.has(requestId));
    try {
      const zip = new JSZip();

      for (const file of files) {
        if (isCanceled()) {
          throw new Error('Zip export canceled');
        }

        if (!file?.name) {
          continue;
        }

        if (typeof file.sourcePath === 'string' && file.sourcePath) {
          try {
            const entryStat = await fs.lstat(file.sourcePath);
            let isRegularFile = entryStat.isFile();

            // Follow symlink target only when needed and keep non-regular files out
            if (!isRegularFile && entryStat.isSymbolicLink()) {
              try {
                const targetStat = await fs.stat(file.sourcePath);
                isRegularFile = targetStat.isFile();
              } catch {
                isRegularFile = false;
              }
            }

            if (!isRegularFile) {
              continue;
            }

            // Guard against hanging reads on unusual filesystems / special files
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => {
              abortController.abort();
            }, 10000);

            try {
              if (isCanceled()) {
                abortController.abort();
              }
              const fileBuffer = await fs.readFile(file.sourcePath, { signal: abortController.signal });
              if (isCanceled()) {
                throw new Error('Zip export canceled');
              }
              zip.file(file.name, fileBuffer);
            } finally {
              clearTimeout(timeoutId);
            }
          } catch (error) {
            mainWarn('fsBridge', `Skip source file while creating zip: ${file.sourcePath}`, error);
          }
          continue;
        }

        if (typeof file.content === 'string') {
          zip.file(file.name, file.content);
          continue;
        }

        if (file.content instanceof Uint8Array) {
          zip.file(file.name, Buffer.from(file.content));
          continue;
        }

        // Handle serialized Uint8Array from IPC payload
        if (file.content && typeof file.content === 'object') {
          const objectLike = file.content as Record<string, unknown>;
          const keys = Object.keys(objectLike);
          const isTypedArrayLike = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
          if (isTypedArrayLike) {
            const values = keys
              .sort((a, b) => Number(a) - Number(b))
              .map((key) => {
                const value = objectLike[key];
                return typeof value === 'number' ? value : Number(value ?? 0);
              });
            zip.file(file.name, Buffer.from(values));
            continue;
          }
        }
      }

      const zipBuffer = await zip.generateAsync(
        {
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 9 },
        },
        () => {
          if (isCanceled()) {
            throw new Error('Zip export canceled');
          }
        }
      );

      if (isCanceled()) {
        throw new Error('Zip export canceled');
      }
      await fs.writeFile(filePath, zipBuffer);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('canceled')) {
        // Zip export was canceled, silently return false
      } else {
        mainError('fsBridge', 'Failed to create zip file:', error);
      }
      return false;
    } finally {
      if (requestId) {
        canceledZipRequests.delete(requestId);
      }
    }
  });

  // 获取文件元数据
  ipcBridge.fs.getFileMetadata.provider(async ({ path: filePath }) => {
    try {
      const stats = await fs.stat(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        size: stats.size,
        type: '', // MIME type可以根据扩展名推断
        lastModified: stats.mtime.getTime(),
      };
    } catch (error) {
      mainError('fsBridge', 'Failed to get file metadata:', error);
      throw error;
    }
  });

  // 复制文件到工作空间
  ipcBridge.fs.copyFilesToWorkspace.provider(async ({ filePaths, workspace, sourceRoot }) => {
    try {
      const copiedFiles: string[] = [];
      const failedFiles: Array<{ path: string; error: string }> = [];

      // 确保工作空间目录存在 / Ensure workspace directory exists
      await fs.mkdir(workspace, { recursive: true });

      for (const filePath of filePaths) {
        try {
          let targetPath: string;

          if (sourceRoot) {
            // Preserve directory structure / 保留目录结构
            const relativePath = path.relative(sourceRoot, filePath);
            targetPath = path.join(workspace, relativePath);

            // Ensure parent directory exists / 确保父目录存在
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
          } else {
            // Flatten to root (legacy behavior) / 扁平化到根目录（旧行为）
            const fileName = path.basename(filePath);
            targetPath = path.join(workspace, fileName);
          }

          // 检查目标文件是否已存在
          const exists = await fs
            .access(targetPath)
            .then(() => true)
            .catch(() => false);

          let finalTargetPath = targetPath;
          if (exists) {
            // 如果文件已存在，添加时间戳后缀 / Append timestamp when target file already exists
            const timestamp = Date.now();
            const ext = path.extname(targetPath);
            const name = path.basename(targetPath, ext);
            // Construct new path in the same directory / 在同一目录下构建新路径
            const dir = path.dirname(targetPath);
            const newFileName = `${name}${NEXUS_TIMESTAMP_SEPARATOR}${timestamp}${ext}`;
            finalTargetPath = path.join(dir, newFileName);
          }

          await fs.copyFile(filePath, finalTargetPath);
          copiedFiles.push(finalTargetPath);
        } catch (error) {
          // 记录失败的文件路径与错误信息，前端可以用来提示用户 / Record failed file info so UI can warn user
          const message = error instanceof Error ? error.message : String(error);
          mainError('fsBridge', `Failed to copy file ${filePath}:`, message);
          failedFiles.push({ path: filePath, error: message });
        }
      }

      // 只要存在失败文件就视作部分失败，并返回提示信息 / Mark operation as non-success if anything failed and provide hint text
      const success = failedFiles.length === 0;
      const msg = success ? undefined : 'Some files failed to copy';

      return {
        success,
        data: { copiedFiles, failedFiles },
        msg,
      };
    } catch (error) {
      mainError('fsBridge', 'Failed to copy files to workspace:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Delete file or directory on disk (删除磁盘上的文件或文件夹)
  ipcBridge.fs.removeEntry.provider(async ({ path: targetPath }) => {
    try {
      // Breadcrumb: file delete
      fileBreadcrumbs.delete(targetPath);

      const stats = await fs.lstat(targetPath);
      if (stats.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true });
      } else {
        await fs.unlink(targetPath);

        // 发送流式删除事件到预览面板（用于关闭预览）
        // Send streaming delete event to preview panel (to close preview)
        try {
          const pathSegments = targetPath.split(path.sep);
          const fileName = pathSegments[pathSegments.length - 1];
          const workspace = pathSegments.slice(0, -1).join(path.sep);

          ipcBridge.fileStream.contentUpdate.emit({
            filePath: targetPath,
            content: '',
            workspace: workspace,
            relativePath: fileName,
            operation: 'delete',
          });
        } catch (emitError) {
          mainError('fsBridge', 'Failed to emit file stream delete:', emitError);
        }
      }
      return { success: true };
    } catch (error) {
      // Breadcrumb: file delete error
      fileBreadcrumbs.error('delete', targetPath, (error as Error).message);

      mainError('fsBridge', 'Failed to remove entry:', error);
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Rename file or directory and return new path (重命名文件/文件夹并返回新路径)
  ipcBridge.fs.renameEntry.provider(async ({ path: targetPath, newName }) => {
    try {
      const directory = path.dirname(targetPath);
      const newPath = path.join(directory, newName);

      if (newPath === targetPath) {
        // Skip when the new name equals the original path (新旧路径一致时直接跳过)
        return { success: true, data: { newPath } };
      }

      const exists = await fs
        .access(newPath)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        // Avoid overwriting existing targets (避免覆盖已存在的目标文件)
        return { success: false, msg: 'Target path already exists' };
      }

      await fs.rename(targetPath, newPath);
      return { success: true, data: { newPath } };
    } catch (error) {
      mainError('fsBridge', 'Failed to rename entry:', error);
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 读取内置 rules 文件 / Read built-in rules file from app resources
  ipcBridge.fs.readBuiltinRule.provider(async ({ fileName }) => {
    try {
      return await readBuiltinResource('rules', fileName);
    } catch (error) {
      mainError('fsBridge', 'Failed to read builtin rule:', error);
      throw error;
    }
  });

  // 读取内置 skills 文件 / Read built-in skills file from app resources
  ipcBridge.fs.readBuiltinSkill.provider(async ({ fileName }) => {
    try {
      return await readBuiltinResource('skills', fileName);
    } catch (error) {
      mainError('fsBridge', 'Failed to read builtin skill:', error);
      throw error;
    }
  });

  // 读取助手规则文件 / Read assistant rule file from user directory or builtin rules
  ipcBridge.fs.readAssistantRule.provider(async ({ assistantId, locale = 'en-US' }) => {
    try {
      return await readAssistantResource('rules', assistantId, locale, ruleFilePattern);
    } catch (error) {
      mainError('fsBridge', 'Failed to read assistant rule:', error);
      throw error;
    }
  });

  // 写入助手规则文件 / Write assistant rule file to user directory
  ipcBridge.fs.writeAssistantRule.provider(({ assistantId, content, locale = 'en-US' }) => {
    return writeAssistantResource('rules', assistantId, content, locale, ruleFilePattern);
  });

  // 删除助手规则文件 / Delete assistant rule files
  ipcBridge.fs.deleteAssistantRule.provider(({ assistantId }) => {
    return deleteAssistantResource('rules', new RegExp(`^${assistantId}\\..*\\.md$`));
  });

  // 读取助手技能文件 / Read assistant skill file from user directory or builtin skills
  ipcBridge.fs.readAssistantSkill.provider(async ({ assistantId, locale = 'en-US' }) => {
    try {
      return await readAssistantResource('skills', assistantId, locale, skillFilePattern);
    } catch (error) {
      mainError('fsBridge', 'Failed to read assistant skill:', error);
      throw error;
    }
  });

  // 写入助手技能文件 / Write assistant skill file to user directory
  ipcBridge.fs.writeAssistantSkill.provider(({ assistantId, content, locale = 'en-US' }) => {
    return writeAssistantResource('skills', assistantId, content, locale, skillFilePattern);
  });

  // 删除助手技能文件 / Delete assistant skill files
  ipcBridge.fs.deleteAssistantSkill.provider(({ assistantId }) => {
    return deleteAssistantResource('skills', new RegExp(`^${assistantId}-skills\\..*\\.md$`));
  });

  // 获取可用 skills 列表 / List available skills from both builtin and user directories
  ipcBridge.fs.listAvailableSkills.provider(async () => {
    try {
      const skills: Array<{ name: string; description: string; location: string; isCustom: boolean }> = [];

      // 辅助函数：从目录读取 skills
      const readSkillsFromDir = async (skillsDir: string, isCustomDir: boolean) => {
        try {
          await fs.access(skillsDir);
          const entries = await fs.readdir(skillsDir, { withFileTypes: true });

          for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            // 跳过所有 `_` 前缀目录（_system, _hub, _my-custom-skill, _builtin），使用子目录扫描
            // Skip all `_` prefixed directories, handle them via subdirectory scanning
            if (entry.name.startsWith('_')) continue;

            const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');

            try {
              const content = await fs.readFile(skillMdPath, 'utf-8');
              // 解析 YAML front matter
              const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
              if (frontMatterMatch) {
                const yaml = frontMatterMatch[1];
                const nameMatch = yaml.match(/^name:\s*(.+)$/m);
                const descMatch = yaml.match(/^description:\s*['"]?(.+?)['"]?$/m);
                if (nameMatch) {
                  skills.push({
                    name: nameMatch[1].trim(),
                    description: descMatch ? descMatch[1].trim() : '',
                    location: skillMdPath,
                    isCustom: isCustomDir,
                  });
                }
              }
            } catch {
              // Skill directory without SKILL.md, skip
            }
          }
        } catch {
          // Directory doesn't exist, skip
        }
      };

      // 读取内置 skills (isCustom: false) from bundled resources
      const builtinSkillsDir = await findBuiltinResourceDir('skills');
      const builtinCountBefore = skills.length;
      await readSkillsFromDir(builtinSkillsDir, false);
      const builtinCount = skills.length - builtinCountBefore;

      // 读取用户目录中的 skills（分目录结构 + 旧版扁平结构）
      // Read user skills (categorized subdirectories + legacy flat structure)
      const userSkillsDir = getUserSkillsDir();

      // Scan _my-custom-skill/ (custom, isCustom: true)
      const customDir = path.join(userSkillsDir, '_my-custom-skill');
      await readSkillsFromDir(customDir, true);

      // Scan _hub/ (hub-installed, isCustom: true)
      const hubDir = path.join(userSkillsDir, '_hub');
      await readSkillsFromDir(hubDir, true);

      // Scan _system/ (builtin, isCustom: false)
      const systemDir = path.join(userSkillsDir, '_system');
      await readSkillsFromDir(systemDir, false);

      // Legacy: scan flat user skills directory
      const userCountBefore = skills.length;
      await readSkillsFromDir(userSkillsDir, true);
      const userCount = skills.length - userCountBefore;

      // 去重：优先级 自定义 > Hub > 内置
      // Deduplicate: priority custom > hub > builtin (first occurrence wins for custom)
      const skillMap = new Map<string, { name: string; description: string; location: string; isCustom: boolean }>();
      for (const skill of skills) {
        const existing = skillMap.get(skill.name);
        if (!existing) {
          skillMap.set(skill.name, skill);
        }
      }
      const deduplicatedSkills = Array.from(skillMap.values());

      mainLog('fsBridge', `Listed ${deduplicatedSkills.length} available skills (${skills.length} before deduplication):`);
      mainLog('fsBridge', `  - Builtin skills (${builtinCount}): ${builtinSkillsDir}`);
      mainLog('fsBridge', `  - User skills (${userCount}): ${userSkillsDir}`);
      mainLog('fsBridge', `  - Skills breakdown:`, deduplicatedSkills.map((s) => `${s.name} (${s.isCustom ? 'custom' : 'builtin'})`).join(', '));

      return deduplicatedSkills;
    } catch (error) {
      mainError('fsBridge', 'Failed to list available skills:', error);
      return [];
    }
  });

  // 读取 skill 信息（不导入）/ Read skill info without importing
  ipcBridge.fs.readSkillInfo.provider(async ({ skillPath }) => {
    try {
      // 验证 SKILL.md 文件存在 / Verify SKILL.md file exists
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      try {
        await fs.access(skillMdPath);
      } catch {
        return {
          success: false,
          msg: 'SKILL.md file not found in the selected directory',
        };
      }

      // 读取 SKILL.md 获取 skill 信息 / Read SKILL.md to get skill info
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      let skillName = path.basename(skillPath); // 默认使用目录名 / Default to directory name
      let skillDescription = '';

      if (frontMatterMatch) {
        const yaml = frontMatterMatch[1];
        const nameMatch = yaml.match(/^name:\s*(.+)$/m);
        const descMatch = yaml.match(/^description:\s*['"]?(.+?)['"]?$/m);
        if (nameMatch) {
          skillName = nameMatch[1].trim();
        }
        if (descMatch) {
          skillDescription = descMatch[1].trim();
        }
      }

      return {
        success: true,
        data: {
          name: skillName,
          description: skillDescription,
        },
        msg: 'Skill info loaded successfully',
      };
    } catch (error) {
      mainError('fsBridge', 'Failed to read skill info:', error);
      return {
        success: false,
        msg: `Failed to read skill info: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  // 导入 skill 目录 / Import skill directory
  ipcBridge.fs.importSkill.provider(async ({ skillPath }) => {
    try {
      // 验证 SKILL.md 文件存在 / Verify SKILL.md file exists
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      try {
        await fs.access(skillMdPath);
      } catch {
        return {
          success: false,
          msg: 'SKILL.md file not found in the selected directory',
        };
      }

      // 读取 SKILL.md 获取 skill 名称 / Read SKILL.md to get skill name
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      let skillName = path.basename(skillPath); // 默认使用目录名 / Default to directory name

      if (frontMatterMatch) {
        const yaml = frontMatterMatch[1];
        const nameMatch = yaml.match(/^name:\s*(.+)$/m);
        if (nameMatch) {
          skillName = nameMatch[1].trim();
        }
      }

      // 获取用户 skills 目录 / Get user skills directory
      const userSkillsDir = getUserSkillsDir();
      const targetDir = path.join(userSkillsDir, skillName);

      // 检查是否已存在同名 skill（同时检查内置和用户目录）/ Check if skill already exists in both builtin and user directories
      const builtinSkillsDir = await findBuiltinResourceDir('skills');
      const builtinTargetDir = path.join(builtinSkillsDir, skillName);

      try {
        await fs.access(targetDir);
        return {
          success: false,
          msg: `Skill "${skillName}" already exists in user skills`,
        };
      } catch {
        // User skill doesn't exist
      }

      try {
        await fs.access(builtinTargetDir);
        return {
          success: false,
          msg: `Skill "${skillName}" already exists in builtin skills`,
        };
      } catch {
        // Builtin skill doesn't exist, proceed with copy
      }

      // 复制整个目录 / Copy entire directory
      await copyDirectory(skillPath, targetDir);

      mainLog('fsBridge', `Successfully imported skill "${skillName}" to ${targetDir}`);

      return {
        success: true,
        data: { skillName },
        msg: `Skill "${skillName}" imported successfully`,
      };
    } catch (error) {
      mainError('fsBridge', 'Failed to import skill:', error);
      return {
        success: false,
        msg: `Failed to import skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  // 扫描目录下的 skills / Scan directory for skills
  //
  // Parses YAML front matter from each SKILL.md. Besides the existing
  // `name` / `description` fields we also extract optional `icon` / `color`
  // so the right-side 可用技能 panel (see WorkspaceSkills.tsx) can render the
  // icon chosen by the skill author instead of a keyword-based heuristic.
  //
  //   ---
  //   name: browser
  //   description: 浏览器操作
  //   icon: Browser        # matches ui.zip reference → icon-park component
  //   color: "#3B82F6"     # hex / rgb(...) / named ('blue', 'red', etc.)
  //   ---
  //
  // Both fields are optional; the renderer falls back to a name-based mapping
  // when either is missing.
  ipcBridge.fs.scanForSkills.provider(async ({ folderPath }) => {
    mainLog('fsBridge', `scanForSkills called with path: ${folderPath}`);

    try {
      const skills = await scanWorkspaceSkills(folderPath);

      mainLog('fsBridge', `scanForSkills finished. Found ${skills.length} skills.`);
      return {
        success: true,
        data: skills,
        msg: `Found ${skills.length} skills`,
      };
    } catch (error) {
      mainError('fsBridge', 'Failed to scan skills:', error);
      return {
        success: false,
        msg: `Failed to scan skills: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  // 检测 skills 路径 / Detect skills path
  ipcBridge.fs.detectCommonSkillPaths.provider(async () => {
    try {
      const candidates = [{ name: 'Sudowork', path: getSkillsDir() }];

      const detected: Array<{ name: string; path: string }> = [];
      for (const candidate of candidates) {
        try {
          await fs.access(candidate.path);
          detected.push(candidate);
        } catch {
          // Path doesn't exist
        }
      }

      return {
        success: true,
        data: detected,
        msg: `Detected ${detected.length} common paths`,
      };
    } catch (error) {
      mainError('fsBridge', 'Failed to detect common paths:', error);
      return {
        success: false,
        msg: 'Failed to detect common paths',
      };
    }
  });
}
