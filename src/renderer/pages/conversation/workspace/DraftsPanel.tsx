/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DraftsPanel component - displays and manages drafts (intermediate files)
 * 草稿箱面板组件 - 展示和管理草稿箱中的中间文件
 */

import { ipcBridge } from '@/common';
import { Delete, FileText, FolderClose } from '@icon-park/react';
import { Empty, Message, Modal, Popconfirm, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface DraftFile {
  name: string;
  size: number;
  modifiedAt: number;
}

interface DraftsPanelProps {
  workspace: string;
  /** Key to trigger refresh (increment to refresh) */
  refreshKey?: number;
}

const DraftsPanel: React.FC<DraftsPanelProps> = ({ workspace, refreshKey }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadDrafts = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const result = await ipcBridge.drafts.listDrafts.invoke({ workspace });
      if (result.success && result.data) {
        setFiles(result.data);
      }
    } catch {
      // Silently handle - drafts panel is optional
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts, refreshKey]);

  const handleDeleteDraft = useCallback(
    async (fileName: string) => {
      try {
        const result = await ipcBridge.drafts.deleteDraft.invoke({ workspace, fileName });
        if (result.success) {
          Message.success(t('conversation.workspace.drafts.deleteSuccess'));
          void loadDrafts();
        } else {
          Message.error(t('conversation.workspace.drafts.deleteFailed'));
        }
      } catch {
        Message.error(t('conversation.workspace.drafts.deleteFailed'));
      }
    },
    [workspace, loadDrafts, t]
  );

  const handleClearDrafts = useCallback(async () => {
    try {
      const result = await ipcBridge.drafts.clearDrafts.invoke({ workspace });
      if (result.success) {
        Message.success(t('conversation.workspace.drafts.clearSuccess'));
        setFiles([]);
      }
    } catch {
      // Handle silently
    }
  }, [workspace, t]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (files.length === 0 && !loading) {
    return null; // Don't show drafts panel when empty
  }

  return (
    <div className='mb-8px'>
      <div
        className='flex items-center justify-between px-8px py-6px cursor-pointer rounded-6px transition-colors hover:bg-fill-2'
        onClick={() => setExpanded(!expanded)}
      >
        <div className='flex items-center gap-6px text-13px text-t-secondary'>
          <FolderClose theme='outline' size='14' />
          <span className='font-medium'>{t('conversation.workspace.drafts.title')}</span>
          <span className='text-12px opacity-60'>
            ({t('conversation.workspace.drafts.fileCount', { count: files.length })})
          </span>
        </div>
        <div className='flex items-center gap-4px'>
          {files.length > 0 && (
            <Popconfirm
              title={t('conversation.workspace.drafts.clearConfirm')}
              onOk={(e) => {
                e?.stopPropagation();
                void handleClearDrafts();
              }}
              onCancel={(e) => e?.stopPropagation()}
              getPopupContainer={() => document.body}
            >
              <Tooltip content={t('conversation.workspace.drafts.clearAll')}>
                <button
                  className='flex items-center p-2px rounded-4px hover:bg-fill-3 transition-colors border-none bg-transparent cursor-pointer'
                  onClick={(e) => e.stopPropagation()}
                >
                  <Delete theme='outline' size='12' fill='var(--color-text-3)' />
                </button>
              </Tooltip>
            </Popconfirm>
          )}
          <span
            className='text-12px transition-transform'
            style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          >
            &#9660;
          </span>
        </div>
      </div>

      {expanded && (
        <div className='pl-12px'>
          {files.length === 0 ? (
            <Empty
              description={t('conversation.workspace.drafts.empty')}
              className='py-8px'
            />
          ) : (
            <div className='flex flex-col gap-2px'>
              {files.map((file) => (
                <div
                  key={file.name}
                  className='flex items-center justify-between px-8px py-4px rounded-4px hover:bg-fill-2 transition-colors group'
                >
                  <div className='flex items-center gap-6px min-w-0 flex-1'>
                    <FileText theme='outline' size='13' fill='var(--color-text-3)' />
                    <span className='text-13px text-t-primary truncate'>{file.name}</span>
                    <span className='text-11px text-t-secondary opacity-60 whitespace-nowrap'>
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                  <Tooltip content={t('conversation.workspace.contextMenu.deleteTitle')}>
                    <button
                      className='opacity-0 group-hover:opacity-100 flex items-center p-2px rounded-4px hover:bg-fill-3 transition-all border-none bg-transparent cursor-pointer'
                      onClick={() => {
                        Modal.confirm({
                          title: t('conversation.workspace.contextMenu.deleteTitle'),
                          content: file.name,
                          onOk: () => handleDeleteDraft(file.name),
                        });
                      }}
                    >
                      <Delete theme='outline' size='12' fill='var(--color-text-3)' />
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DraftsPanel;
