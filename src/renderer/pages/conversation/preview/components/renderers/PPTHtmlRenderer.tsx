/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PPTHtmlRendererProps {
  filePath?: string; // PPTX 文件路径 / PPTX file path
}

/**
 * PPT 幻灯片 HTML 渲染器 (使用 pptx-preview 库)
 * PPT slide HTML renderer (using pptx-preview library)
 *
 * 功能：
 * 1. 使用 pptx-preview 库直接渲染 PPTX 文件
 * 2. 保留幻灯片的样式、布局、颜色、字体等
 * 3. 支持幻灯片切换导航
 */
const PPTHtmlRenderer: React.FC<PPTHtmlRendererProps> = ({ filePath }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slideCount, setSlideCount] = useState(0);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<any>(null);
  const [messageApi, messageContextHolder] = Message.useMessage();

  // 初始化 pptx-preview
  useEffect(() => {
    let previewer: any = null;
    let arrayBuffer: ArrayBuffer | null = null;
    let isMounted = true;

    const initPreview = async () => {
      if (!filePath) {
        setError(t('preview.errors.missingFilePath'));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // 1. 动态导入 pptx-preview
        const { init } = await import('pptx-preview');

        // 2. 通过 IPC 读取 PPTX 文件为 ArrayBuffer
        const response = await ipcBridge.document.convert.invoke({ filePath, to: 'pptx-arraybuffer' });

        if (response.to !== 'pptx-arraybuffer' || !response.result.success || !response.result.data) {
          throw new Error(response.result.error || t('preview.ppt.loadFailed'));
        }

        arrayBuffer = response.result.data as ArrayBuffer;

        // 3. 初始化预览器
        if (containerRef.current) {
          // 清空容器
          containerRef.current.innerHTML = '';

          // 初始化 pptx-preview，使用 slide 模式
          previewer = init(containerRef.current, {
            width: containerRef.current.clientWidth || 800,
            height: containerRef.current.clientHeight || 600,
            mode: 'slide', // 使用幻灯片模式，支持翻页
          });

          previewerRef.current = previewer;

          // 4. 渲染 PPTX
          await previewer.preview(arrayBuffer);

          // 5. 使用 previewer 的 slideCount 属性获取幻灯片数量
          if (isMounted) {
            const count = previewer.slideCount ?? 1;
            setSlideCount(count);
            messageApi.success(t('preview.ppt.loadSuccess'));
          }
        }
      } catch (err) {
        if (!isMounted) return;
        const defaultMessage = t('preview.ppt.loadFailed');
        const errorMessage = err instanceof Error ? err.message : defaultMessage;
        setError(`${errorMessage}`);
        messageApi.error(errorMessage);
        console.error('[PPTHtmlRenderer] Failed to initialize pptx-preview:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void initPreview();

    // 清理函数
    return () => {
      isMounted = false;
      if (previewer?.destroy) {
        previewer.destroy();
      }
      previewerRef.current = null;
    };
  }, [filePath, t, messageApi]);

  // 导航控制 - 使用 previewer 的方法进行幻灯片切换
  const handlePrevious = useCallback(() => {
    previewerRef.current?.renderPreSlide();
  }, []);

  const handleNext = useCallback(() => {
    previewerRef.current?.renderNextSlide();
  }, []);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 防止默认行为（如页面滚动）
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
        e.preventDefault();
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        handleNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        handlePrevious();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrevious]);

  // 监听预览器的 currentIndex 变化，同步更新 UI
  useEffect(() => {
    const interval = setInterval(() => {
      if (previewerRef.current) {
        const newIndex = previewerRef.current.currentIndex ?? 0;
        if (newIndex !== currentSlideIndex) {
          setCurrentSlideIndex(newIndex);
        }
      }
    }, 200);

    return () => clearInterval(interval);
  }, [currentSlideIndex]);

  // 计算导航状态
  const hasNext = currentSlideIndex < slideCount - 1;
  const hasPrev = currentSlideIndex > 0;

  if (loading) {
    return (
      <div className='h-full w-full flex items-center justify-center bg-bg-1'>
        <div className='text-center'>
          <div className='text-48px mb-16px'>📊</div>
          <div className='text-14px text-t-secondary'>{t('preview.ppt.loading')}</div>
        </div>
        {messageContextHolder}
      </div>
    );
  }

  if (error) {
    return (
      <div className='h-full w-full flex items-center justify-center bg-bg-1'>
        <div className='text-center max-w-400px'>
          <div className='text-48px mb-16px'>❌</div>
          <div className='text-16px text-t-error font-medium mb-8px'>{t('preview.ppt.loadFailed')}</div>
          <div className='text-12px text-t-secondary mb-24px whitespace-pre-wrap'>{error}</div>
        </div>
        {messageContextHolder}
      </div>
    );
  }

  return (
    <div className='h-full w-full flex flex-col bg-bg-1'>
      {messageContextHolder}

      {/* 幻灯片内容区域 */}
      <div
        ref={containerRef}
        className='flex-1 overflow-auto bg-white'
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />

      {/* 底部导航栏 */}
      {slideCount > 1 && (
        <div className='h-48px flex items-center justify-between px-24px bg-bg-2 border-t border-border-1 flex-shrink-0'>
          {/* 上一页按钮 */}
          <Button size='small' disabled={!hasPrev} onClick={handlePrevious} style={{ minWidth: '80px' }}>
            {t('preview.ppt.previous')}
          </Button>

          {/* 页码指示器 */}
          <div className='text-13px text-t-secondary'>{t('preview.ppt.slideOf', { current: currentSlideIndex + 1, total: slideCount })}</div>

          {/* 下一页按钮 */}
          <Button size='small' disabled={!hasNext} onClick={handleNext} style={{ minWidth: '80px' }}>
            {t('preview.ppt.next')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default PPTHtmlRenderer;
