/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { AudioFile } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLocalFileUrl } from '@renderer/utils/platform';
import { usePreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';

interface AudioViewerProps {
  filePath?: string;
  content?: string;
  fileName?: string;
}

const AudioViewer: React.FC<AudioViewerProps> = ({ filePath, content, fileName }) => {
  const { t } = useTranslation();
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const [error, setError] = useState<string | null>(null);
  const audioSrc = useMemo(() => content || resolveLocalFileUrl(filePath) || '', [content, filePath]);

  useEffect(() => {
    setError(null);
  }, [audioSrc]);

  useEffect(() => {
    if (!toolbarExtrasContext) return;
    toolbarExtrasContext.setExtras({
      left: (
        <div className='flex items-center gap-8px'>
          <span className='flex items-center gap-4px text-13px text-secondary'>
            <AudioFile theme='filled' size='14' fill='currentColor' />
            {t('preview.audio.title', { defaultValue: 'Audio' })}
          </span>
          <span className='text-11px text-tertiary'>{t('preview.readOnlyLabel')}</span>
        </div>
      ),
      right: null,
    });
    return () => toolbarExtrasContext.setExtras(null);
  }, [toolbarExtrasContext, t]);

  if (!audioSrc) {
    return (
      <div className='flex-1 f-center p-24px'>
        <div className='text-center text-14px text-secondary'>{t('preview.audio.pathMissing', { defaultValue: 'Audio file path is missing' })}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex-1 f-center p-24px'>
        <div className='max-w-520px text-center'>
          <div className='text-15px text-foreground mb-8px'>{error}</div>
          {filePath && <div className='text-12px text-tertiary break-all'>{filePath}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className='flex-1 f-center p-24px overflow-hidden'>
      <div className='w-full max-w-560px flex flex-col items-center gap-16px'>
        <AudioFile theme='filled' size='48' fill='var(--color-text-3)' />
        <div className='max-w-full truncate text-14px text-secondary'>{fileName || filePath || t('preview.audio.title', { defaultValue: 'Audio' })}</div>
        <audio
          key={audioSrc}
          src={audioSrc}
          className='w-full'
          controls
          preload='metadata'
          title={fileName || filePath || t('preview.audio.title', { defaultValue: 'Audio' })}
          onError={() => {
            setError(t('preview.audio.loadFailed', { defaultValue: 'Unable to play this audio in the built-in player. Try opening it with the system default app.' }));
          }}
        />
      </div>
    </div>
  );
};

export default AudioViewer;
