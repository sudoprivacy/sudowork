/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageFileSend } from '@/common/chatLib';
import { FileText, Picture } from '@icon-park/react';
import React from 'react';

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
};

const MessageFileSend: React.FC<{ message: IMessageFileSend }> = ({ message }) => {
  const { fileName, fileType } = message.content;
  const ext = fileName ? '.' + fileName.split('.').pop()?.toLowerCase() : '';
  const typeLabel = FILE_TYPE_LABELS[ext] || '文件';

  if (fileType === 'image') {
    return (
      <div className='w-full'>
        <div className='bg-message-tips rd-8px p-x-12px p-y-8px flex items-center gap-8px'>
          <Picture theme='filled' size='18' className='flex-shrink-0 text-t-secondary' />
          <span className='text-t-secondary text-13px'>{fileName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className='w-full'>
      <div className='bg-message-tips rd-8px p-x-12px p-y-8px flex items-center gap-8px'>
        <FileText theme='filled' size='18' className='flex-shrink-0 text-t-secondary' />
        <div className='flex flex-col gap-2px'>
          <span className='text-t-primary text-14px'>{fileName}</span>
          <span className='text-t-tertiary text-12px'>{typeLabel}</span>
        </div>
      </div>
    </div>
  );
};

export default MessageFileSend;
