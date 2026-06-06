/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeneratedFileEntry } from '@/common/generatedFiles';
import { ipcBridge } from '@/common';
import { iconColors } from '@/renderer/theme/colors';
import { usePreviewLauncher } from '@/renderer/hooks/usePreviewLauncher';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/preview/utils/fileUtils';
import { formatFileSize } from '@/renderer/services/FileService';
import { resolveFileIcon } from '@/renderer/utils/fileIcon';
import { emitter } from '@/renderer/utils/emitter';
import { Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface GeneratedFileCardProps {
  entry: GeneratedFileEntry;
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
const GeneratedFileCard: React.FC<GeneratedFileCardProps> = ({ entry }) => {
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

  const sizeLabel = typeof resolvedSize === 'number' ? formatFileSize(resolvedSize) : '';
  const kindLabel = entry.kind === 'edit' ? t('messages.generatedFile.kindEdit') : t('messages.generatedFile.kindCreate');

  return (
    <Tooltip content={missing ? t('messages.generatedFile.missingHint') : entry.path} position='top' mini>
      <div
        className={classNames(
          'group inline-flex items-center gap-8px px-10px py-8px rd-10px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] cursor-pointer transition-all',
          'hover:bg-[var(--color-bg-3)] hover:border-[var(--color-border-3)] active:scale-[0.98]',
          { 'opacity-50 cursor-not-allowed': missing || loading },
        )}
        onClick={handleClick}
        role='button'
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <div className='flex-shrink-0' style={{ color: iconColors.primary, lineHeight: 0 }}>
          {resolveFileIcon(fileName, { size: 20 })}
        </div>
        <div className='min-w-0 flex flex-col leading-tight'>
          <div className='flex items-center gap-6px'>
            <span className='text-13px text-t-primary truncate max-w-220px font-medium'>{fileName}</span>
            <span className={classNames('text-10px px-4px py-1px rd-3px flex-shrink-0', missing ? 'bg-[var(--color-danger-light-1)] text-[var(--color-danger)]' : 'bg-[var(--color-success-light-1)] text-[var(--color-success)]')}>{missing ? t('messages.generatedFile.statusMissing') : kindLabel}</span>
          </div>
          <div className='text-11px text-t-secondary truncate max-w-260px'>
            {directory && <span className='opacity-70 mr-6px'>{directory}/</span>}
            {sizeLabel && <span>{sizeLabel}</span>}
            {sizeLabel && ext && <span className='mx-4px opacity-50'>·</span>}
            {ext && <span className='uppercase opacity-70'>{ext}</span>}
          </div>
        </div>
      </div>
    </Tooltip>
  );
};

interface GeneratedFileCardsProps {
  entries: GeneratedFileEntry[];
}

/**
 * Container that renders the list of generated-file cards in a horizontal
 * wrap. Empty list is a no-op (returns null) so callers can safely render
 * the component without conditional logic.
 */
const GeneratedFileCards: React.FC<GeneratedFileCardsProps> = ({ entries }) => {
  if (!entries || entries.length === 0) return null;
  return (
    <div className='flex flex-wrap gap-8px'>
      {entries.map((entry) => (
        <GeneratedFileCard key={entry.path} entry={entry} />
      ))}
    </div>
  );
};

export default GeneratedFileCards;
export { GeneratedFileCard };
