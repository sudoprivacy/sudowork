/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Picture } from '@icon-park/react';
import React, { useCallback } from 'react';
import type { IMessageFileSend } from '@sudowork/common/chatLib';
import type { PreviewContentType } from '@sudowork/common/types/preview';
import { usePreviewLauncher } from '@renderer/hooks/usePreviewLauncher';
import { resolveFileIcon } from '@renderer/utils/fileIcon';

const FILE_TYPE_LABELS: Record<string, string> = {
  '.pdf': 'PDF 文档',
  '.doc': 'Word 文档',
  '.docx': 'Word 文档',
  '.xls': 'Excel 表格',
  '.xlsx': 'Excel 表格',
  '.ppt': 'PowerPoint 演示文稿',
  '.pptx': 'PowerPoint 演示文稿',
  '.csv': 'CSV 文件',
  '.txt': '文本文件',
  '.md': 'Markdown 文件',
  '.html': 'HTML 文件',
  '.jpg': 'JPEG 图片',
  '.jpeg': 'JPEG 图片',
  '.png': 'PNG 图片',
  '.webp': 'WebP 图片',
  '.gif': 'GIF 图片',
  '.tiff': 'TIFF 图片',
  '.bmp': 'BMP 图片',
  '.svg': 'SVG 图片',
  '.mp4': '视频文件',
  '.webm': '视频文件',
  '.mov': '视频文件',
  '.m4v': '视频文件',
  '.ogv': '视频文件',
  '.avi': '视频文件',
  '.mkv': '视频文件',
  '.wmv': '视频文件',
  '.flv': '视频文件',
  '.mp3': '音频文件',
  '.wav': '音频文件',
  '.flac': '音频文件',
  '.aac': '音频文件',
  '.m4a': '音频文件',
  '.ogg': '音频文件',
  '.oga': '音频文件',
  '.opus': '音频文件',
  '.amr': '音频文件',
  '.wma': '音频文件',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv', 'wmv', 'flv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'amr', 'wma']);
const OFFICE_EXTENSIONS: Record<string, PreviewContentType> = {
  ppt: 'ppt',
  pptx: 'ppt',
  odp: 'ppt',
  doc: 'word',
  docx: 'word',
  odt: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ods: 'excel',
  csv: 'excel',
};

export const getContentTypeFromExt = (ext: string): PreviewContentType => {
  const e = ext.toLowerCase();
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (e === 'diff' || e === 'patch') return 'diff';
  if (e === 'pdf') return 'pdf';
  if (OFFICE_EXTENSIONS[e]) return OFFICE_EXTENSIONS[e];
  if (e === 'html' || e === 'htm') return 'html';
  if (IMAGE_EXTENSIONS.has(e)) return 'image';
  if (VIDEO_EXTENSIONS.has(e)) return 'video';
  if (AUDIO_EXTENSIONS.has(e)) return 'audio';
  return 'code';
};

const MessageFileSend: React.FC<{ message: IMessageFileSend }> = ({ message }) => {
  const { filePath, fileName, fileType } = message.content;
  const ext = fileName ? fileName.split('.').pop()?.toLowerCase() || '' : '';
  const typeLabel = FILE_TYPE_LABELS['.' + ext] || '文件';
  const { launchPreview, loading } = usePreviewLauncher();

  const handleClick = useCallback(() => {
    if (!filePath || loading) return;
    const contentType = fileType === 'image' ? 'image' : getContentTypeFromExt(ext);
    void launchPreview({
      originalPath: filePath,
      fileName,
      contentType,
      editable: false,
    });
  }, [filePath, fileName, fileType, ext, launchPreview, loading]);

  const clickableProps = filePath ? { className: 'cursor-pointer select-none', onClick: handleClick } : {};

  if (fileType === 'image') {
    return (
      <div className='w-full'>
        <div className='bg-message-tips rd-8px p-x-12px p-y-8px flex items-center gap-8px' {...clickableProps}>
          <Picture theme='filled' size='18' className='flex-shrink-0 text-secondary' />
          <span className='text-secondary text-13px'>{fileName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className='w-full'>
      <div className='bg-message-tips rd-8px p-x-12px p-y-8px flex items-center gap-8px' {...clickableProps}>
        <span className='flex-shrink-0'>{resolveFileIcon(fileName, { size: 18, theme: 'filled' })}</span>
        <div className='flex flex-col gap-2px'>
          <span className='text-foreground text-14px'>{fileName}</span>
          <span className='text-tertiary text-12px'>{typeLabel}</span>
        </div>
      </div>
    </div>
  );
};

export default MessageFileSend;
