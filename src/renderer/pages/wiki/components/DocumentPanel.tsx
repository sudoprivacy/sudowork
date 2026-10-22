/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Message, Popconfirm, Progress, Space, Table, Typography } from '@arco-design/web-react';
import { FolderUp, Upload } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocumentRecord } from '../api/types';
import type { WikiApi } from '../api/wikiApi';
import { wikiErrorMessage } from '../utils/errors';
import { batchBySize, fileToBase64, formatSize, formatTime, MAX_DOC_SIZE, splitRelativePath } from '../utils/files';

interface IUploadProgress {
  done: number;
  total: number;
}

/** Documents of one private folder, with file / folder upload and delete. */
export default function DocumentPanel({ api, nodeId, nodeName, documents, isLoading, remainingBytes, onChanged }: IDocumentPanelProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<IUploadProgress | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /** Reject oversized files and anything past the remaining quota before sending bytes. */
  const precheck = (files: File[]): File[] => {
    const tooBig = files.filter((f) => f.size > MAX_DOC_SIZE);
    if (tooBig.length) Message.warning(t('wiki.documents.tooBig', { names: tooBig.map((f) => f.name).join(', ') }));
    const ok = files.filter((f) => f.size <= MAX_DOC_SIZE);
    const total = ok.reduce((sum, f) => sum + f.size, 0);
    if (total > remainingBytes) {
      Message.error(t('wiki.documents.quotaExceeded', { size: formatSize(total), remaining: formatSize(Math.max(0, remainingBytes)) }));
      return [];
    }
    return ok;
  };

  // One file per request: base64 + JSON roughly triples memory per file.
  const uploadFiles = async (picked: File[]) => {
    const files = precheck(picked);
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    let failed = 0;
    for (const [index, file] of files.entries()) {
      try {
        await api.uploadDocument(nodeId, { file_name: file.name, mime_type: file.type || undefined, content_base64: await fileToBase64(file) });
      } catch (err) {
        failed++;
        Message.error(`${file.name}: ${wikiErrorMessage(t, err)}`);
      }
      setProgress({ done: index + 1, total: files.length });
    }
    setProgress(null);
    if (failed < files.length) Message.success(t('wiki.documents.uploaded', { count: files.length - failed }));
    onChanged();
  };

  // Folder upload is additive on the server, so large folders go up in batches.
  const uploadFolder = async (picked: File[]) => {
    const files = precheck(picked);
    if (!files.length) return;
    const { folderName } = splitRelativePath(files[0].webkitRelativePath || files[0].name);
    const batches = batchBySize(files);
    setProgress({ done: 0, total: files.length });
    let done = 0;
    let uploaded = 0;
    for (const batch of batches) {
      try {
        const payload = await Promise.all(
          batch.map(async (file) => ({
            relative_path: splitRelativePath(file.webkitRelativePath || file.name).innerPath,
            mime_type: file.type || undefined,
            content_base64: await fileToBase64(file),
          }))
        );
        const res = await api.uploadFolder(nodeId, { folder_name: folderName || undefined, on_conflict: 'replace', files: payload });
        uploaded += res.documents.length;
      } catch (err) {
        Message.error(wikiErrorMessage(t, err));
      }
      done += batch.length;
      setProgress({ done, total: files.length });
    }
    setProgress(null);
    if (uploaded > 0) Message.success(t('wiki.documents.uploaded', { count: uploaded }));
    onChanged();
  };

  const onDelete = async (doc: DocumentRecord) => {
    try {
      await api.deleteDocument(doc.id);
      onChanged();
    } catch (err) {
      Message.error(wikiErrorMessage(t, err));
    }
  };

  const isUploading = progress !== null;

  return (
    <div
      className={`flex flex-col gap-12px rd-8px ${isDragOver ? 'outline outline-2 outline-dashed outline-[rgb(var(--primary-6))]' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (!isUploading) void uploadFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className='flex items-center justify-between gap-12px'>
        <Typography.Text bold className='truncate'>
          {nodeName}
        </Typography.Text>
        <Space>
          <Button size='small' icon={<Upload size={14} />} loading={isUploading} onClick={() => fileInputRef.current?.click()}>
            {t('wiki.documents.uploadFiles')}
          </Button>
          <Button size='small' icon={<FolderUp size={14} />} disabled={isUploading} onClick={() => folderInputRef.current?.click()}>
            {t('wiki.documents.uploadFolder')}
          </Button>
        </Space>
        <input
          ref={fileInputRef}
          type='file'
          multiple
          className='hidden'
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            void uploadFiles(list);
          }}
        />
        <input
          ref={folderInputRef}
          type='file'
          className='hidden'
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            void uploadFolder(list);
          }}
        />
      </div>
      {progress && <Progress percent={Math.round((progress.done / Math.max(1, progress.total)) * 100)} formatText={() => `${progress.done}/${progress.total}`} />}
      <Typography.Text type='secondary' className='text-12px'>
        {t('wiki.documents.dropHint', { size: formatSize(MAX_DOC_SIZE) })}
      </Typography.Text>
      <Table
        size='small'
        rowKey='id'
        loading={isLoading}
        data={documents}
        pagination={documents.length > 20 ? { pageSize: 20, size: 'mini' } : false}
        noDataElement={<Empty description={t('wiki.documents.empty')} />}
        columns={[
          { title: t('wiki.documents.fileName'), dataIndex: 'fileName', ellipsis: true },
          { title: t('wiki.documents.size'), dataIndex: 'sizeBytes', width: 100, render: (v: number) => formatSize(v) },
          { title: t('wiki.documents.uploadedAt'), dataIndex: 'uploadedAt', width: 180, render: (v: number) => formatTime(v) },
          {
            title: '',
            width: 70,
            render: (_: unknown, doc: DocumentRecord) => (
              <Popconfirm title={t('wiki.documents.deleteConfirm', { name: doc.fileName })} onOk={() => onDelete(doc)}>
                <Button size='mini' type='text' status='danger'>
                  {t('wiki.common.delete')}
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );
}

interface IDocumentPanelProps {
  api: WikiApi;
  nodeId: string;
  nodeName: string;
  documents: DocumentRecord[];
  isLoading: boolean;
  /** Quota left in the private space, checked before uploading. */
  remainingBytes: number;
  onChanged: () => void;
}
