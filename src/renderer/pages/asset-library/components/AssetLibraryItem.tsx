import { Dropdown, Menu, Message } from '@arco-design/web-react';
import { FolderOpen, MessageCircle, MoreHorizontal } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { AssetLibraryEntry } from '@/common/generatedFiles';
import { formatFileSize } from '@/renderer/services/FileService';
import { resolveFileIcon } from '@/renderer/utils/fileIcon';

export default function AssetLibraryItem({ entry, onOpenConversation, onMissing }: IAssetLibraryItemProps) {
  const { t } = useTranslation();
  const fileName = (entry.relativePath ?? entry.path).split(/[\\/]/).pop() || entry.path;
  const [isValidated, setIsValidated] = useState(false);
  const [resolvedSize, setResolvedSize] = useState<number | undefined>(entry.size);

  useEffect(() => {
    let isCancelled = false;
    ipcBridge.fs.getFileMetadata
      .invoke({ path: entry.path })
      .then((metadata) => {
        if (isCancelled) return;
        if (!metadata) {
          onMissing(entry.path);
          return;
        }
        if (typeof metadata.size === 'number') setResolvedSize(metadata.size);
        setIsValidated(true);
      })
      .catch(() => {
        if (!isCancelled) onMissing(entry.path);
      });

    return () => {
      isCancelled = true;
    };
  }, [entry.path, onMissing]);

  const onShowInFolder = () => {
    ipcBridge.shell.showItemInFolder.invoke(entry.path).catch((error: unknown) => {
      Message.error(String(error instanceof Error ? error.message : error));
    });
  };

  if (!isValidated) return null;

  const sizeLabel = typeof resolvedSize === 'number' ? formatFileSize(resolvedSize) : '';
  const kindLabel = entry.kind === 'edit' ? t('messages.generatedFile.kindEdit') : t('messages.generatedFile.kindCreate');

  return (
    <article className='box-border flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-border bg-card px-3 py-3 text-left shadow-sm transition-all hover:border-deep hover:bg-accent hover:shadow-md'>
      {resolveFileIcon(fileName, { size: 26 })}
      <div className='min-w-0 flex-1'>
        <div className='truncate text-15px font-semibold text-foreground'>{fileName}</div>
        <div className='mt-1 truncate text-12px text-foreground-secondary'>
          <span className='opacity-75'>{entry.conversationName}</span>
          {sizeLabel ? <span className='ml-2'>{sizeLabel}</span> : null}
          {entry.ext ? <span className='ml-2 uppercase opacity-70'>{entry.ext}</span> : null}
          <span className='ml-2 opacity-70'>{new Date(entry.createdAt).toLocaleString()}</span>
        </div>
      </div>
      <div className='ml-auto flex shrink-0 flex-col items-end gap-2'>
        <span className='rounded-full bg-fill-shallow px-1.5 py-0.5 text-10px font-medium text-success'>{kindLabel}</span>
        <Dropdown
          trigger='click'
          position='br'
          getPopupContainer={() => document.body}
          droplist={
            <Menu>
              <Menu.Item key='show-in-folder' onClick={onShowInFolder}>
                <div className='flex items-center gap-2'>
                  <FolderOpen size={14} />
                  <span>{t('messages.generatedFile.showInFolder')}</span>
                </div>
              </Menu.Item>
              <Menu.Item key='open-conversation' onClick={onOpenConversation}>
                <div className='flex items-center gap-2'>
                  <MessageCircle size={14} />
                  <span>{t('messages.generatedFile.jumpToConversation')}</span>
                </div>
              </Menu.Item>
            </Menu>
          }
        >
          <button type='button' aria-label={t('common.ariaLabel.more')} className='f-center cursor-pointer rounded-md border-0 bg-transparent p-1.5 text-foreground-secondary hover:bg-accent hover:text-foreground' style={{ lineHeight: 0 }}>
            <MoreHorizontal size={16} />
          </button>
        </Dropdown>
      </div>
    </article>
  );
}

interface IAssetLibraryItemProps {
  entry: AssetLibraryEntry;
  onOpenConversation: () => void;
  onMissing: (path: string) => void;
}
