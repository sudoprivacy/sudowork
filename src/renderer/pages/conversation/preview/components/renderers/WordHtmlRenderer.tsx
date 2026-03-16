/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import HTMLRenderer from './HTMLRenderer';

interface WordHtmlRendererProps {
  content: string; // HTML 内容 / HTML content
  filePath?: string; // 文件路径 / File path
  containerRef?: React.RefObject<HTMLDivElement>; // 容器引用 / Container ref
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void; // 滚动回调 / Scroll callback
  hideToolbar?: boolean; // 隐藏工具栏（兼容接口，实际不使用）/ Hide toolbar (for compatibility)
}

/**
 * Word 文档 HTML 渲染器
 * Word document HTML renderer
 *
 * 基于 HTMLRenderer，针对 Word 文档的 HTML 输出进行优化
 * Based on HTMLRenderer, optimized for Word document HTML output
 */
const WordHtmlRenderer: React.FC<WordHtmlRendererProps> = ({ content, filePath, containerRef, onScroll, hideToolbar }) => {
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const effectiveContainerRef = containerRef || internalContainerRef;

  // hideToolbar  unused for HTML renderer (for compatibility only)
  void hideToolbar;

  return (
    <div ref={effectiveContainerRef} className='h-full w-full overflow-auto bg-white'>
      <HTMLRenderer content={content} filePath={filePath} containerRef={effectiveContainerRef} onScroll={onScroll} />
    </div>
  );
};

export default WordHtmlRenderer;
