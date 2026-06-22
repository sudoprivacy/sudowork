/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Close } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import type { PreviewContentType } from '@/common/types/preview';
import { getFileExtension } from '@/renderer/services/FileService';
import { ipcBridge } from '@/common';
import { Image } from '@arco-design/web-react';
import { resolveFileIcon } from '@/renderer/utils/fileIcon';
import { usePreviewLauncher } from '@/renderer/hooks/usePreviewLauncher';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

const isImageFile = (path: string): boolean => {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.'));
  return IMAGE_EXTS.includes(ext);
};

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
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
};

const getContentTypeFromExt = (ext: string): PreviewContentType => {
  const e = ext.toLowerCase();
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (e === 'diff' || e === 'patch') return 'diff';
  if (e === 'pdf') return 'pdf';
  if (OFFICE_EXTENSIONS[e]) return OFFICE_EXTENSIONS[e];
  if (e === 'csv') return 'code';
  if (e === 'html' || e === 'htm') return 'html';
  if (IMAGE_EXTENSIONS.has(e)) return 'image';
  if (VIDEO_EXTENSIONS.has(e)) return 'video';
  if (AUDIO_EXTENSIONS.has(e)) return 'audio';
  return 'code';
};

interface FilePreviewProps {
  path: string;
  onRemove: () => void;
  readonly?: boolean;
}

const FilePreview: React.FC<FilePreviewProps> = ({ path, onRemove, readonly = false }) => {
  // Defensive check: ensure path is a string
  if (typeof path !== 'string') {
    console.error('[FilePreview] Invalid path type:', typeof path, path);
    return null;
  }

  const isImage = isImageFile(path);
  // 直接从路径中提取文件名，不清理时间戳后缀
  // Extract filename directly from path without cleaning timestamp suffix
  const fileName = path.split(/[\\/]/).pop() || '';
  const fileExt = getFileExtension(path).toUpperCase().replace('.', '');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [fileSize, setFileSize] = useState<string>('');
  // Track whether the file was not found (ENOENT) so we don't retry on
  // remount and avoid spamming the backend with repeated IPC calls for a
  // file that doesn't exist.
  const [fileError, setFileError] = useState(false);
  const { launchPreview, loading } = usePreviewLauncher();

  const handlePreviewClick = useCallback(() => {
    if (!readonly || loading || fileError) return;
    const ext = getFileExtension(path).replace('.', '');
    const contentType = getContentTypeFromExt(ext);
    void launchPreview({
      originalPath: path,
      fileName,
      contentType,
      editable: false,
    });
  }, [readonly, loading, fileError, path, fileName, launchPreview]);

  useEffect(() => {
    // bdpan:// paths are remote — skip local fs operations
    if (path.startsWith('bdpan://')) return;

    // Reset error state when path changes
    setFileError(false);

    let cancelled = false;

    // 获取文件大小
    ipcBridge.fs.getFileMetadata
      .invoke({ path })
      .then((metadata) => {
        if (!cancelled) setFileSize(formatFileSize(metadata.size));
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[FilePreview] Failed to get file metadata:', { path, error });
          setFileError(true);
        }
      });

    // 如果是图片，获取图片的base64
    // If it's an image, get its base64 data
    if (isImage) {
      ipcBridge.fs.getImageBase64
        .invoke({ path })
        .then((base64) => {
          if (!cancelled) setImageUrl(base64);
        })
        .catch((error) => {
          if (!cancelled) {
            console.error('[FilePreview] Failed to load image:', { path, error });
            setFileError(true);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [path, isImage]);

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove();
  };

  if (isImage) {
    return (
      <div className='relative inline-block'>
        <div className='rd-8px overflow-hidden border border-solid b-color-border-2'>{imageUrl ? <Image src={imageUrl} alt={fileName} width={60} height={60} className='object-cover cursor-pointer' preview /> : <div className='w-60px h-60px'></div>}</div>
        {!readonly && (
          <div className='absolute -top-4px -right-4px w-16px h-16px rd-50% bg-white dark:bg-gray-700 cursor-pointer f-center shadow-md hover:shadow-lg transition-all z-10 border border-solid border-gray-200 dark:border-gray-600' onClick={handleRemove}>
            <Close theme='filled' size='10' fill='#666' />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className='relative inline-block mb-10px'>
      <div className={readonly && !fileError ? 'h-60px flex items-center gap-12px px-12px rd-8px border border-solid cursor-pointer select-none' : 'h-60px flex items-center gap-12px px-12px rd-8px border border-solid'} style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-sm)' }} onClick={handlePreviewClick}>
        <div className='w-40px h-40px rd-8px f-center flex-shrink-0'>{resolveFileIcon(fileName, { size: 28, theme: 'filled' })}</div>
        <div className='flex flex-col gap-2px min-w-0'>
          <span className='text-14px text-foreground max-w-150px truncate'>{fileName}</span>
          <span className='text-12px text-secondary'>
            {fileExt}: {fileSize || '...'}
          </span>
        </div>
      </div>
      {!readonly && (
        <div className='absolute -top-4px -right-4px w-16px h-16px rd-50% bg-white dark:bg-gray-700 cursor-pointer f-center shadow-md hover:shadow-lg transition-all z-10 border border-solid border-gray-200 dark:border-gray-600' onClick={handleRemove}>
          <Close theme='filled' size='10' fill='#666' />
        </div>
      )}
    </div>
  );
};

export default FilePreview;
