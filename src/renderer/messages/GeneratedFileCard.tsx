/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { FolderOpen, ShareOne } from '@icon-park/react';
import { Message, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeneratedFileEntry } from '@/common/generatedFiles';
import { ipcBridge } from '@/common';
import { usePreviewLauncher } from '@/renderer/hooks/usePreviewLauncher';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/preview/utils/fileUtils';
import { formatFileSize } from '@/renderer/services/FileService';
import { resolveFileIcon } from '@/renderer/utils/fileIcon';
import { emitter } from '@/renderer/utils/emitter';

interface GeneratedFileCardProps {
  entry: GeneratedFileEntry;
  fullWidth?: boolean;
}

/**
 * One preview chip representing a file the AI just produced this turn.
 *
 * Click dispatch:
 *  - `.html` / `.htm`  → right-panel BrowserPanel (via `right-panel.browser.open`
 *    emitter, same path AI-generated HTML auto-opening uses).
 *  - anything else     → PreviewPanel overlay via `usePreviewLauncher`.
 *
 * Stale-file check on mount: if the file has been moved / deleted by the time
 * the message is being rendered, the card dims itself and disables clicking.
 */
const GeneratedFileCard: React.FC<GeneratedFileCardProps> = ({ entry, fullWidth = false }) => {
  const { t } = useTranslation();
  const fileName = (entry.relativePath ?? entry.path).split(/[\\/]/).pop() || entry.path;
  const directory = (() => {
    const display = entry.relativePath ?? entry.path;
    const idx = Math.max(display.lastIndexOf('/'), display.lastIndexOf('\\'));
    return idx > 0 ? display.slice(0, idx) : '';
  })();
  const ext = entry.ext || '';
  const isHtml = ext === 'html' || ext === 'htm';

  const [missing, setMissing] = useState(false);
  const [resolvedSize, setResolvedSize] = useState<number | undefined>(entry.size);

  const { launchPreview, loading } = usePreviewLauncher();

  useEffect(() => {
    let cancelled = false;
    ipcBridge.fs.getFileMetadata
      .invoke({ path: entry.path })
      .then((meta) => {
        if (cancelled) return;
        if (typeof meta?.size === 'number') setResolvedSize(meta.size);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  const handleClick = useCallback(() => {
    if (missing || loading) return;
    if (isHtml) {
      // Same channel that AI-write-HTML auto-open uses (browser-panel-cdp PR).
      // BrowserPanel's subscriber pushes a new tab + activates; ChatSider's
      // subscriber switches the right-panel selection to the browser tab.
      emitter.emit('right-panel.browser.open', { url: `file://${entry.path}`, switchTab: true });
      return;
    }
    const contentType = getContentTypeByExtension(entry.path);
    void launchPreview({
      originalPath: entry.path,
      fileName,
      contentType,
      editable: false,
    });
  }, [missing, loading, isHtml, entry.path, fileName, launchPreview]);

  const handleOpenExternal = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (missing) return;
      ipcBridge.shell.openFile.invoke(entry.path).catch((err: unknown) => {
        Message.error(String(err instanceof Error ? err.message : err));
      });
    },
    [entry.path, missing]
  );

  const handleShowInFolder = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (missing) return;
      ipcBridge.shell.showItemInFolder.invoke(entry.path).catch((err: unknown) => {
        Message.error(String(err instanceof Error ? err.message : err));
      });
    },
    [entry.path, missing]
  );

  const sizeLabel = typeof resolvedSize === 'number' ? formatFileSize(resolvedSize) : '';
  const kindLabel = entry.kind === 'edit' ? t('messages.generatedFile.kindEdit') : t('messages.generatedFile.kindCreate');

  return (
    <Tooltip content={missing ? t('messages.generatedFile.missingHint') : entry.path} position='top' mini>
      <div
        className={classNames(
          'group min-w-0 items-center gap-12px overflow-hidden rounded-16px border border-light bg-[var(--color-bg-2)] px-12px py-12px text-left transition-all',
          fullWidth ? 'flex w-full' : 'inline-flex max-w-full',
          'hover:bg-[var(--color-bg-3)] hover:border-bold active:scale-[0.98]',
          {
            'opacity-50 cursor-not-allowed': missing || loading,
          }
        )}
        onClick={handleClick}
        role='button'
        tabIndex={0}
        aria-label={fileName}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <div className='flex h-48px w-48px shrink-0 items-center justify-center rounded-16px border border-light bg-fill-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]' style={{ color: 'var(--foreground)', lineHeight: 0 }}>
          {resolveFileIcon(fileName, { size: 26 })}
        </div>
        <div className='min-w-0 flex flex-col gap-4px leading-tight'>
          <div className='flex items-center gap-8px'>
            <span className='max-w-full truncate text-15px font-semibold text-foreground'>{fileName}</span>
            <span className={classNames('shrink-0 rounded-full px-6px py-1px text-[10px] font-medium', missing ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success')}>{missing ? t('messages.generatedFile.statusMissing') : kindLabel}</span>
          </div>
          <div className='max-w-full truncate text-12px text-secondary'>
            {directory ? <span className='opacity-75'>{directory}</span> : null}
            {!directory && sizeLabel && <span>{sizeLabel}</span>}
            {!directory && sizeLabel && ext && <span className='mx-4px opacity-50'>·</span>}
            {!directory && ext && <span className='uppercase opacity-70'>{ext}</span>}
            {directory && sizeLabel ? <span className='ml-2 rounded-full bg-fill-1 px-6px py-1px text-[10px] leading-4 text-secondary'>{sizeLabel}</span> : null}
            {directory && ext ? <span className='ml-6px rounded-full bg-fill-1 px-6px py-1px text-[10px] leading-4 uppercase tracking-wide text-secondary'>{ext}</span> : null}
          </div>
        </div>
        {!missing && (
          // Secondary actions: open with system app + reveal in OS file manager.
          // Hidden by default to keep the card visually quiet; revealed on
          // group-hover. stopPropagation in handlers so they don't trigger
          // the card's primary in-app preview click.
          <div className='ml-auto flex shrink-0 items-center gap-2px opacity-0 transition-opacity group-hover:opacity-100'>
            <Tooltip content={t(isHtml ? 'messages.generatedFile.openInSystemBrowser' : 'messages.generatedFile.openWithDefaultApp')} position='top' mini>
              <button type='button' onClick={handleOpenExternal} className='flex items-center justify-center rounded-4px border-0 bg-transparent p-4px cursor-pointer hover:bg-[var(--color-bg-1)]' style={{ lineHeight: 0 }}>
                <ShareOne size='14' fill={'var(--text-secondary)'} />
              </button>
            </Tooltip>
            <Tooltip content={t('messages.generatedFile.showInFolder')} position='top' mini>
              <button type='button' onClick={handleShowInFolder} className='flex items-center justify-center rounded-4px border-0 bg-transparent p-4px cursor-pointer hover:bg-[var(--color-bg-1)]' style={{ lineHeight: 0 }}>
                <FolderOpen size='14' fill={'var(--text-secondary)'} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </Tooltip>
  );
};

interface GeneratedFileCardsProps {
  entries: GeneratedFileEntry[];
  layout?: 'grid' | 'stack';
  fullWidth?: boolean;
}

/**
 * Container that renders the list of generated-file cards in a horizontal
 * wrap. Empty list is a no-op (returns null) so callers can safely render
 * the component without conditional logic.
 */
const GeneratedFileCards: React.FC<GeneratedFileCardsProps> = ({ entries, layout = 'grid', fullWidth = false }) => {
  if (!entries || entries.length === 0) return null;
  return (
    <div className={layout === 'stack' ? 'flex flex-col gap-8px' : 'flex flex-wrap gap-8px'}>
      {entries.map((entry) => (
        <GeneratedFileCard key={entry.path} entry={entry} fullWidth={fullWidth} />
      ))}
    </div>
  );
};

export default GeneratedFileCards;
export { GeneratedFileCard };
