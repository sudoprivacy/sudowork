/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveLocalFileUrl } from '@/renderer/utils/platform';
import { usePreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';
import { VideoFile } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface VideoViewerProps {
  filePath?: string;
  content?: string;
  fileName?: string;
}

const VideoViewer: React.FC<VideoViewerProps> = ({ filePath, content, fileName }) => {
  const { t } = useTranslation();
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const [error, setError] = useState<string | null>(null);
  const videoSrc = useMemo(() => content || resolveLocalFileUrl(filePath) || '', [content, filePath]);

  useEffect(() => {
    setError(null);
  }, [videoSrc]);

  useEffect(() => {
    if (!toolbarExtrasContext) return;
    toolbarExtrasContext.setExtras({
      left: (
        <div className='flex items-center gap-8px'>
          <span className='flex items-center gap-4px text-13px text-secondary'>
            <VideoFile theme='filled' size='14' fill='currentColor' />
            {t('preview.video.title', { defaultValue: 'Video' })}
          </span>
          <span className='text-11px text-tertiary'>{t('preview.readOnlyLabel')}</span>
        </div>
      ),
      right: null,
    });
    return () => toolbarExtrasContext.setExtras(null);
  }, [toolbarExtrasContext, t]);

  if (!videoSrc) {
    return (
      <div className='flex-1 f-center bg-bg-1 p-24px'>
        <div className='text-center text-14px text-secondary'>{t('preview.video.pathMissing', { defaultValue: 'Video file path is missing' })}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex-1 f-center bg-bg-1 p-24px'>
        <div className='max-w-520px text-center'>
          <div className='text-15px text-foreground mb-8px'>{error}</div>
          {filePath && <div className='text-12px text-tertiary break-all'>{filePath}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className='flex-1 f-center bg-black overflow-hidden'>
      <video
        key={videoSrc}
        src={videoSrc}
        className='w-full h-full object-contain'
        controls
        preload='metadata'
        title={fileName || filePath || t('preview.video.title', { defaultValue: 'Video' })}
        onError={() => {
          setError(t('preview.video.loadFailed', { defaultValue: 'Unable to play this video in the built-in player. Try opening it with the system default app.' }));
        }}
      />
    </div>
  );
};

export default VideoViewer;
