/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { AudioFile, FileCode, FileExcel, FileGif, FileJpg, FilePdf, FilePpt, FileText, FileTxt, FileWord, FileZip, VideoFile } from '@icon-park/react';
import type { Theme } from '@icon-park/react/es/runtime';
import React from 'react';

export interface FileIconOptions {
  size?: number | string;
  theme?: Theme;
}

/**
 * 根据文件名后缀返回对应的文件类型图标
 * Returns an appropriate file type icon based on the file extension.
 *
 * Consistent with the workspace file-tree icons so the same visual language
 * is used everywhere in the app (chat messages, input-box attachments, etc.).
 */
export function resolveFileIcon(fileName: string, options: FileIconOptions = {}): React.ReactNode {
  const { size = 16, theme = 'outline' } = options;
  const extension = fileName.toLowerCase().split('.').pop() ?? '';

  switch (extension) {
    case 'txt':
    case 'log':
    case 'text':
      return <FileTxt theme={theme} size={size} fill='var(--color-text-3)' />;
    case 'md':
    case 'markdown':
    case 'mdx':
      return <FileText theme={theme} size={size} fill='var(--color-text-2)' />;
    case 'doc':
    case 'docx':
    case 'wps':
    case 'rtf':
    case 'odt':
      return <FileWord theme={theme} size={size} fill='#3b82f6' />;
    case 'pdf':
      return <FilePdf theme={theme} size={size} fill='#ef4444' />;
    case 'ppt':
    case 'pptx':
    case 'key':
    case 'odp':
      return <FilePpt theme={theme} size={size} fill='#f97316' />;
    case 'xls':
    case 'xlsx':
    case 'csv':
    case 'ods':
      return <FileExcel theme={theme} size={size} fill='#22c55e' />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'mjs':
    case 'cjs':
    case 'json':
    case 'jsonc':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
    case 'html':
    case 'htm':
    case 'css':
    case 'scss':
    case 'less':
    case 'py':
    case 'java':
    case 'go':
    case 'rs':
    case 'c':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'h':
    case 'hpp':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'sql':
    case 'swift':
    case 'kt':
    case 'kts':
    case 'rb':
    case 'php':
    case 'lua':
    case 'r':
    case 'dart':
    case 'vue':
    case 'svelte':
      return <FileCode theme={theme} size={size} fill='#8b5cf6' />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'bmp':
    case 'svg':
    case 'ico':
    case 'tif':
    case 'tiff':
    case 'avif':
      return <FileJpg theme={theme} size={size} fill='#06b6d4' />;
    case 'gif':
      return <FileGif theme={theme} size={size} fill='#06b6d4' />;
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
    case 'tgz':
    case 'bz2':
    case 'xz':
      return <FileZip theme={theme} size={size} fill='#f59e0b' />;
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
    case 'm4a':
    case 'ogg':
    case 'wma':
      return <AudioFile theme={theme} size={size} fill='#ec4899' />;
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'mkv':
    case 'webm':
    case 'm4v':
    case 'wmv':
    case 'flv':
      return <VideoFile theme={theme} size={size} fill='#6366f1' />;
    default:
      return <FileText theme={theme} size={size} fill='var(--color-text-3)' />;
  }
}
