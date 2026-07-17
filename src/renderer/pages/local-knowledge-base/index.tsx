import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Empty, Form, Input, List, Message, Modal, Progress, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { BookOpen, Edit3, FileText, Folder, Play, Plus, RefreshCw, Search, Settings, Trash2 } from 'lucide-react';
import { ipcBridge } from '@/common';
import type { ILocalKbBuildJob, ILocalKbDependencyStatus, ILocalKbDocument, ILocalKbInstallProgress, ILocalKbSearchHit, ILocalKbSpace } from '@/common/types/localKnowledgeBase';

const DOCUMENT_PAGE_SIZE = 6;
const LOCAL_KB_PANEL_CARD_CLASS = 'flex h-[420px] min-h-0 min-w-0 flex-col overflow-hidden [&_.arco-card-body]:h-0 [&_.arco-card-body]:flex-1';
const FLEX_CARD_BODY_STYLE: React.CSSProperties = {
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
};

export default function LocalKnowledgeBasePage() {
  const { t } = useTranslation();
  const [spaces, setSpaces] = useState<ILocalKbSpace[]>([]);
  const [documents, setDocuments] = useState<ILocalKbDocument[]>([]);
  const [jobs, setJobs] = useState<ILocalKbBuildJob[]>([]);
  const [dependencies, setDependencies] = useState<ILocalKbDependencyStatus | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isQueueingBuild, setIsQueueingBuild] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [isSpaceModalOpen, setIsSpaceModalOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<ILocalKbSpace | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ILocalKbSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [spaceQuery, setSpaceQuery] = useState('');
  const [documentQuery, setDocumentQuery] = useState('');
  const [documentPage, setDocumentPage] = useState(1);
  const [isInstallingEmbedding, setIsInstallingEmbedding] = useState(false);
  const [embeddingInstallProgress, setEmbeddingInstallProgress] = useState<ILocalKbInstallProgress | null>(null);

  const selectedSpace = useMemo(() => spaces.find((space) => space.id === selectedSpaceId) ?? null, [selectedSpaceId, spaces]);
  const visibleSpaces = useMemo(() => {
    const q = spaceQuery.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter((space) => `${space.name}\n${space.description ?? ''}`.toLowerCase().includes(q));
  }, [spaceQuery, spaces]);
  const visibleDocuments = useMemo(() => {
    const q = documentQuery.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((doc) => `${doc.relativePath ?? doc.fileName}\n${doc.fileName}\n${doc.parseStatus}`.toLowerCase().includes(q));
  }, [documentQuery, documents]);
  const pagedDocuments = useMemo(() => visibleDocuments.slice((documentPage - 1) * DOCUMENT_PAGE_SIZE, documentPage * DOCUMENT_PAGE_SIZE), [documentPage, visibleDocuments]);
  const documentPageCount = useMemo(() => Math.max(1, Math.ceil(visibleDocuments.length / DOCUMENT_PAGE_SIZE)), [visibleDocuments.length]);
  const activeJob = useMemo(() => jobs.find((job) => job.status === 'running' || job.status === 'queued') ?? null, [jobs]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [spaceRes, depRes] = await Promise.all([ipcBridge.localKnowledgeBase.listSpaces.invoke(undefined), ipcBridge.localKnowledgeBase.getDependencyStatus.invoke()]);
      if (!spaceRes.success || !depRes.success) {
        throw new Error(spaceRes.msg || depRes.msg);
      }
      const nextSpaces = spaceRes.data ?? [];
      setSpaces(nextSpaces);
      setSelectedSpaceId((current) => (current && nextSpaces.some((space) => space.id === current) ? current : (nextSpaces[0]?.id ?? null)));
      setDependencies(depRes.data ?? null);
    } catch (err) {
      showError(t, err);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const refreshSpaceDetail = useCallback(async () => {
    if (!selectedSpaceId) {
      setDocuments([]);
      setJobs([]);
      return;
    }
    try {
      const [docsRes, jobsRes, statusRes] = await Promise.all([
        ipcBridge.localKnowledgeBase.listDocuments.invoke({ spaceId: selectedSpaceId }),
        ipcBridge.localKnowledgeBase.listBuildJobs.invoke({ spaceId: selectedSpaceId, limit: 20 }),
        ipcBridge.localKnowledgeBase.getBuildStatus.invoke({ spaceId: selectedSpaceId }),
      ]);
      if (docsRes.success) setDocuments(docsRes.data ?? []);
      if (jobsRes.success) setJobs(jobsRes.data ?? []);
      if (statusRes.success && statusRes.data?.space) {
        setSpaces((prev) => prev.map((space) => (space.id === selectedSpaceId ? statusRes.data!.space : space)));
      }
    } catch (err) {
      showError(t, err);
    }
  }, [selectedSpaceId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const offProgress = ipcBridge.localKnowledgeBase.installEmbeddingModelProgress.on((progress) => {
      setEmbeddingInstallProgress(progress);
      setIsInstallingEmbedding(true);
    });
    const offResult = ipcBridge.localKnowledgeBase.installEmbeddingModelResult.on((result) => {
      setIsInstallingEmbedding(false);
      setEmbeddingInstallProgress(null);
      if (result.success) {
        Message.success(t('localKb.embeddingInstallSuccess'));
        void refresh();
      } else {
        Message.error(t('localKb.operationFailed', { message: result.msg }));
      }
    });
    return () => {
      offProgress();
      offResult();
    };
  }, [refresh, t]);

  useEffect(() => {
    void refreshSpaceDetail();
    setHits([]);
    setQuery('');
    setDocumentQuery('');
    setDocumentPage(1);
    if (!selectedSpaceId) return;
    const timer = window.setInterval(() => {
      void refreshSpaceDetail();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshSpaceDetail, selectedSpaceId]);

  const onSubmitSpace = async () => {
    const name = nameValue.trim();
    if (!name) {
      Message.error(t('localKb.nameRequired'));
      return;
    }
    const input = { categoryId: null as string | null, name, description: descriptionValue.trim() || null };
    const res = editingSpace ? await ipcBridge.localKnowledgeBase.updateSpace.invoke({ id: editingSpace.id, updates: input }) : await ipcBridge.localKnowledgeBase.createSpace.invoke({ ...input, sourceMode: 'files' });
    if (!res.success) {
      Message.error(t('localKb.operationFailed', { message: res.msg }));
      return;
    }
    Message.success(t(editingSpace ? 'localKb.updateSpaceSuccess' : 'localKb.createSpaceSuccess'));
    setIsSpaceModalOpen(false);
    setEditingSpace(null);
    setSelectedSpaceId(res.data?.id ?? null);
    setNameValue('');
    setDescriptionValue('');
    await refresh();
  };

  const onEditSpace = (space: ILocalKbSpace) => {
    setEditingSpace(space);
    setNameValue(space.name);
    setDescriptionValue(space.description ?? '');
    setIsSpaceModalOpen(true);
  };

  const onDeleteSpace = (space: ILocalKbSpace) => {
    Modal.confirm({
      title: t('localKb.deleteSpaceTitle'),
      content: t('localKb.deleteSpaceContent', { name: space.name }),
      okText: t('localKb.delete'),
      cancelText: t('localKb.cancel'),
      onOk: async () => {
        const res = await ipcBridge.localKnowledgeBase.deleteSpace.invoke({ id: space.id });
        if (!res.success) {
          Message.error(t('localKb.operationFailed', { message: res.msg }));
          return;
        }
        Message.success(t('localKb.deleteSpaceSuccess'));
        if (selectedSpaceId === space.id) setSelectedSpaceId(null);
        await refresh();
      },
    });
  };

  const onDeleteDocument = (doc: ILocalKbDocument) => {
    if (!selectedSpaceId) return;
    Modal.confirm({
      title: t('localKb.deleteDocumentTitle'),
      content: t('localKb.deleteDocumentContent', { name: doc.relativePath || doc.fileName }),
      okText: t('localKb.delete'),
      cancelText: t('localKb.cancel'),
      onOk: async () => {
        setDeletingDocumentId(doc.id);
        try {
          const res = await ipcBridge.localKnowledgeBase.deleteDocument.invoke({ spaceId: selectedSpaceId, documentId: doc.id });
          if (!res.success) {
            Message.error(t('localKb.operationFailed', { message: res.msg }));
            return;
          }
          Message.success(t('localKb.deleteDocumentSuccess'));
          await refresh();
          await refreshSpaceDetail();
        } finally {
          setDeletingDocumentId(null);
        }
      },
    });
  };

  const onSelectFiles = async () => {
    if (!selectedSpaceId) return;
    const picked = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('localKb.documents'), extensions: ['md', 'markdown', 'txt', 'doc', 'docx', 'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'rtf'] }],
    });
    const filePaths = picked.data?.filePaths ?? [];
    if (picked.data?.canceled || filePaths.length === 0) return;
    setIsImporting(true);
    try {
      const res = await ipcBridge.localKnowledgeBase.addFiles.invoke({ spaceId: selectedSpaceId, filePaths });
      if (!res.success) {
        Message.error(t('localKb.operationFailed', { message: res.msg }));
        return;
      }
      Message.success(t('localKb.importSuccess'));
      await refresh();
      await refreshSpaceDetail();
    } finally {
      setIsImporting(false);
    }
  };

  const onSelectDirectory = async () => {
    if (!selectedSpaceId) return;
    const picked = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
    const directoryPath = picked.data?.filePaths?.[0];
    if (picked.data?.canceled || !directoryPath) return;
    setIsImporting(true);
    try {
      const res = await ipcBridge.localKnowledgeBase.setDirectory.invoke({ spaceId: selectedSpaceId, directoryPath });
      if (!res.success) {
        Message.error(t('localKb.operationFailed', { message: res.msg }));
        return;
      }
      Message.success(t('localKb.importSuccess'));
      await refresh();
      await refreshSpaceDetail();
    } finally {
      setIsImporting(false);
    }
  };

  const onQueueBuild = async () => {
    if (!selectedSpaceId) return;
    setIsQueueingBuild(true);
    try {
      const res = await ipcBridge.localKnowledgeBase.queueBuild.invoke({ spaceId: selectedSpaceId });
      if (!res.success) {
        Message.error(t('localKb.operationFailed', { message: res.msg }));
        return;
      }
      Message.success(t('localKb.buildQueued'));
      await refreshSpaceDetail();
    } finally {
      setIsQueueingBuild(false);
    }
  };

  const onSearch = async () => {
    if (!selectedSpaceId || !query.trim()) return;
    setIsSearching(true);
    try {
      const res = await ipcBridge.localKnowledgeBase.search.invoke({ spaceId: selectedSpaceId, query: query.trim() });
      if (!res.success) {
        Message.error(t('localKb.operationFailed', { message: res.msg }));
        return;
      }
      setHits(res.data?.hits ?? []);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (documentPage > documentPageCount) setDocumentPage(documentPageCount);
  }, [documentPage, documentPageCount]);

  const onInstallEmbeddingModel = async () => {
    setIsInstallingEmbedding(true);
    const res = await ipcBridge.localKnowledgeBase.installEmbeddingModel.invoke(undefined);
    if (!res.success) {
      setIsInstallingEmbedding(false);
      setEmbeddingInstallProgress(null);
      Message.error(t('localKb.operationFailed', { message: res.msg }));
    }
  };

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-color-bg-1 p-4'>
      <div className='mb-4 flex flex-shrink-0 flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0'>
          <Typography.Title heading={4} className='mb-1! flex items-center gap-2'>
            <BookOpen size={20} />
            {t('localKb.title')}
          </Typography.Title>
          <Typography.Text className='block max-w-[760px]' type='secondary'>
            {t('localKb.description')}
          </Typography.Text>
        </div>
        <Button className='flex-shrink-0' icon={<RefreshCw size={16} />} onClick={() => void refresh()}>
          {t('localKb.refresh')}
        </Button>
      </div>

      <Spin loading={isLoading} className='min-h-0 flex-1 [&_.arco-spin-children]:h-full'>
        <div className='grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-4 max-lg:grid-cols-1 max-lg:grid-rows-[260px_minmax(0,1fr)]'>
          <Card className='min-h-0 overflow-hidden' bordered bodyStyle={FLEX_CARD_BODY_STYLE}>
            <div className='mb-3 flex flex-shrink-0 items-center justify-between gap-2'>
              <Typography.Text bold>{t('localKb.spaces')}</Typography.Text>
              <Button size='mini' icon={<Plus size={14} />} onClick={() => openCreateSpaceModal(setIsSpaceModalOpen, setEditingSpace, setNameValue, setDescriptionValue)}>
                {t('localKb.newSpace')}
              </Button>
            </div>
            <Input allowClear className='mb-3 flex-shrink-0' value={spaceQuery} onChange={setSpaceQuery} prefix={<Search size={14} />} placeholder={t('localKb.spaceSearchPlaceholder')} />
            {visibleSpaces.length === 0 ? (
              <Empty description={spaces.length === 0 ? t('localKb.emptySpace') : t('localKb.emptySpaceMatches')} />
            ) : (
              <List
                className='min-h-0 flex-1 overflow-auto'
                size='small'
                dataSource={visibleSpaces}
                render={(space) => (
                  <List.Item key={space.id} className='cursor-pointer' onClick={() => setSelectedSpaceId(space.id)}>
                    <div className='flex w-full min-w-0 items-start justify-between gap-2'>
                      <div className='min-w-0 flex-1'>
                        <Space className='min-w-0'>
                          <BookOpen className='flex-shrink-0' size={16} />
                          <Typography.Text bold={selectedSpaceId === space.id} ellipsis>
                            {space.name}
                          </Typography.Text>
                        </Space>
                        <div className='mt-1 flex flex-wrap gap-1'>
                          <StatusTag value={space.buildStatus} />
                          <Tag size='small'>{space.retrievalMode === 'hybrid' ? t('localKb.hybrid') : t('localKb.grepOnly')}</Tag>
                        </div>
                      </div>
                      <div className='flex items-center gap-1' onClick={(event) => event.stopPropagation()}>
                        <Button size='mini' type='text' icon={<Edit3 size={13} />} disabled={space.buildStatus === 'queued' || space.buildStatus === 'running'} onClick={() => onEditSpace(space)} />
                        <Button size='mini' type='text' status='danger' icon={<Trash2 size={13} />} disabled={space.buildStatus === 'queued' || space.buildStatus === 'running'} onClick={() => onDeleteSpace(space)} />
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>

          <div className='min-h-0 min-w-0 space-y-4 overflow-auto overscroll-contain pr-1'>
            {!selectedSpace ? (
              <Card>
                <Empty description={t('localKb.emptySpace')} />
              </Card>
            ) : (
              <>
                <Card>
                  <div className='flex flex-wrap items-start justify-between gap-4'>
                    <div className='min-w-0 flex-1 basis-[280px]'>
                      <Typography.Title heading={5} className='mb-1! break-words'>
                        {selectedSpace.name}
                      </Typography.Title>
                      {selectedSpace.description && (
                        <Typography.Text className='block break-words' type='secondary'>
                          {selectedSpace.description}
                        </Typography.Text>
                      )}
                      <div className='mt-3 flex flex-wrap gap-2'>
                        <StatusTag value={selectedSpace.buildStatus} />
                        <Tag size='small'>{selectedSpace.retrievalMode === 'hybrid' ? t('localKb.hybrid') : t('localKb.grepOnly')}</Tag>
                        {selectedSpace.lastBuiltAt && <Tag size='small'>{new Date(selectedSpace.lastBuiltAt).toLocaleString()}</Tag>}
                      </div>
                    </div>
                    <Space className='max-sm:w-full max-sm:[&_.arco-btn]:w-full max-sm:[&_.arco-space-item]:w-full' wrap>
                      <Button icon={<FileText size={16} />} loading={isImporting} disabled={selectedSpace.buildStatus === 'running'} onClick={() => void onSelectFiles()}>
                        {t('localKb.selectFiles')}
                      </Button>
                      <Button icon={<Folder size={16} />} loading={isImporting} disabled={selectedSpace.buildStatus === 'running'} onClick={() => void onSelectDirectory()}>
                        {t('localKb.selectDirectory')}
                      </Button>
                      <Button type='primary' icon={<Play size={16} />} loading={isQueueingBuild} disabled={selectedSpace.buildStatus === 'queued' || selectedSpace.buildStatus === 'running' || documents.length === 0} onClick={() => void onQueueBuild()}>
                        {selectedSpace.buildStatus === 'ready' ? t('localKb.rebuild') : t('localKb.build')}
                      </Button>
                    </Space>
                  </div>
                  {selectedSpace.lastBuildError && (
                    <Typography.Text className='mt-3 block break-words' type='error'>
                      {selectedSpace.lastBuildError}
                    </Typography.Text>
                  )}
                  {activeJob && <BuildProgressPanel job={activeJob} documentCount={documents.filter((doc) => doc.parseStatus === 'parsed').length} />}
                </Card>

                <div className='grid grid-cols-2 gap-4 max-xl:grid-cols-1'>
                  <DocumentPanel
                    documents={documents}
                    visibleDocuments={visibleDocuments}
                    pagedDocuments={pagedDocuments}
                    documentQuery={documentQuery}
                    documentPage={documentPage}
                    documentPageCount={documentPageCount}
                    deletingDocumentId={deletingDocumentId}
                    isBuildLocked={selectedSpace.buildStatus === 'queued' || selectedSpace.buildStatus === 'running'}
                    onDocumentQueryChange={(value) => {
                      setDocumentQuery(value);
                      setDocumentPage(1);
                    }}
                    onDocumentPageChange={setDocumentPage}
                    onDeleteDocument={onDeleteDocument}
                  />

                  <Card className={LOCAL_KB_PANEL_CARD_CLASS} bodyStyle={FLEX_CARD_BODY_STYLE} title={t('localKb.jobs')}>
                    {jobs.length === 0 ? (
                      <Empty description={t('localKb.emptyJobs')} />
                    ) : (
                      <List
                        className='min-h-0 flex-1 overflow-auto overscroll-contain'
                        size='small'
                        dataSource={jobs}
                        render={(job) => (
                          <List.Item key={job.id}>
                            <div className='w-full'>
                              <div className='flex flex-wrap items-center justify-between gap-2'>
                                <StatusTag value={job.status} />
                                <Typography.Text className='whitespace-nowrap' type='secondary'>
                                  {new Date(job.createdAt).toLocaleString()}
                                </Typography.Text>
                              </div>
                              <Typography.Text className='block break-words' type='secondary'>
                                {job.currentStep || `${job.progress}%`}
                              </Typography.Text>
                              <Progress className='mt-2' percent={Math.max(0, Math.min(100, job.progress))} size='small' status={job.status === 'failed' ? 'error' : job.status === 'success' ? 'success' : undefined} />
                              <div className='mt-1 flex flex-wrap gap-2'>
                                <Typography.Text type='secondary'>
                                  {t('localKb.elapsed')}: {formatDuration((job.finishedAt ?? Date.now()) - (job.startedAt ?? job.createdAt))}
                                </Typography.Text>
                                {job.startedAt && (
                                  <Typography.Text type='secondary'>
                                    {t('localKb.startedAt')}: {new Date(job.startedAt).toLocaleString()}
                                  </Typography.Text>
                                )}
                                {job.finishedAt && (
                                  <Typography.Text type='secondary'>
                                    {t('localKb.finishedAt')}: {new Date(job.finishedAt).toLocaleString()}
                                  </Typography.Text>
                                )}
                              </div>
                              {job.errorMessage && (
                                <Typography.Text className='block break-words' type='error'>
                                  {job.errorMessage}
                                </Typography.Text>
                              )}
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>

                  <Card
                    className={LOCAL_KB_PANEL_CARD_CLASS}
                    bodyStyle={FLEX_CARD_BODY_STYLE}
                    title={
                      <span className='flex items-center gap-2'>
                        <Settings size={16} />
                        {t('localKb.dependencies')}
                      </span>
                    }
                  >
                    <div className='min-h-0 flex-1 overflow-auto overscroll-contain'>
                      {dependencies && <DependencyList dependencies={dependencies} isInstallingEmbedding={isInstallingEmbedding} embeddingInstallProgress={embeddingInstallProgress} onInstallEmbeddingModel={() => void onInstallEmbeddingModel()} />}
                    </div>
                  </Card>
                  <Card
                    className={LOCAL_KB_PANEL_CARD_CLASS}
                    bodyStyle={FLEX_CARD_BODY_STYLE}
                    title={
                      <span className='flex items-center gap-2'>
                        <Search size={16} />
                        {t('localKb.search')}
                      </span>
                    }
                  >
                    <SearchPanel query={query} hits={hits} isSearching={isSearching} onQueryChange={setQuery} onSearch={() => void onSearch()} />
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>
      </Spin>

      <EntityModal
        isOpen={isSpaceModalOpen}
        title={editingSpace ? t('localKb.editSpace') : t('localKb.newSpace')}
        nameLabel={t('localKb.spaceName')}
        nameValue={nameValue}
        descriptionValue={descriptionValue}
        onNameChange={setNameValue}
        onDescriptionChange={setDescriptionValue}
        onCancel={() => closeEntityModal(setIsSpaceModalOpen, setEditingSpace)}
        onSubmit={() => void onSubmitSpace()}
        submitText={editingSpace ? t('localKb.save') : t('localKb.create')}
      />
    </div>
  );
}

function DocumentPanel({ documents, visibleDocuments, pagedDocuments, documentQuery, documentPage, documentPageCount, deletingDocumentId, isBuildLocked, onDocumentQueryChange, onDocumentPageChange, onDeleteDocument }: IDocumentPanelProps) {
  const { t } = useTranslation();
  const hasDocuments = documents.length > 0;
  const hasMatches = visibleDocuments.length > 0;
  const canTurnPage = documentPageCount > 1;

  return (
    <Card
      className={LOCAL_KB_PANEL_CARD_CLASS}
      bodyStyle={FLEX_CARD_BODY_STYLE}
      title={
        <div className='flex items-center gap-2'>
          <span>{t('localKb.documents')}</span>
          <Tag size='small'>{documents.length}</Tag>
        </div>
      }
    >
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-[40px] flex-shrink-0 items-center gap-2'>
          <Input allowClear className='min-w-[160px] flex-1' value={documentQuery} onChange={onDocumentQueryChange} prefix={<Search size={14} />} placeholder={t('localKb.documentSearchPlaceholder')} />
          <Typography.Text className='whitespace-nowrap' type='secondary'>
            {t('localKb.documentCount', { shown: visibleDocuments.length, total: documents.length })}
          </Typography.Text>
        </div>

        <div className='mt-3 min-h-0 flex-1 overflow-auto overscroll-contain rounded border border-color-border-2'>
          {!hasDocuments ? (
            <div className='flex h-full items-center justify-center'>
              <Empty description={t('localKb.emptyDocuments')} />
            </div>
          ) : !hasMatches ? (
            <div className='flex h-full items-center justify-center'>
              <Empty description={t('localKb.emptyDocumentMatches')} />
            </div>
          ) : (
            <div className='divide-y divide-color-border-2'>
              {pagedDocuments.map((doc) => (
                <div key={doc.id} className='grid min-h-[58px] w-full min-w-0 grid-cols-[minmax(0,1fr)_28px] items-start gap-2 px-3 py-2'>
                  <div className='min-w-0 overflow-hidden'>
                    <Typography.Text className='block' ellipsis>
                      {doc.relativePath || doc.fileName}
                    </Typography.Text>
                    <div className='mt-1 flex flex-wrap gap-2'>
                      <Tag size='small'>{formatSize(doc.sizeBytes)}</Tag>
                      <ParseTag value={doc.parseStatus} />
                    </div>
                  </div>
                  <Button className='h-[24px]! w-[24px]!' size='mini' type='text' status='danger' icon={<Trash2 size={13} />} loading={deletingDocumentId === doc.id} disabled={isBuildLocked} onClick={() => onDeleteDocument(doc)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='mt-3 flex h-[32px] flex-shrink-0 items-center justify-between gap-2 border-t border-color-border-2 pt-3'>
          <Typography.Text className='whitespace-nowrap' type='secondary'>
            {hasMatches ? t('localKb.documentPage', { current: documentPage, total: documentPageCount }) : t('localKb.documentPage', { current: 0, total: 0 })}
          </Typography.Text>
          <Space size='mini'>
            <Button size='mini' disabled={!canTurnPage || documentPage <= 1} onClick={() => onDocumentPageChange((page) => Math.max(1, page - 1))}>
              {t('localKb.previousPage')}
            </Button>
            <Button size='mini' disabled={!canTurnPage || documentPage >= documentPageCount} onClick={() => onDocumentPageChange((page) => Math.min(documentPageCount, page + 1))}>
              {t('localKb.nextPage')}
            </Button>
          </Space>
        </div>
      </div>
    </Card>
  );
}

function SearchPanel({ query, hits, isSearching, onQueryChange, onSearch }: ISearchPanelProps) {
  const { t } = useTranslation();
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-[40px] flex-shrink-0 items-center'>
        <Input allowClear className='w-full' value={query} onChange={onQueryChange} prefix={<Search size={14} />} placeholder={t('localKb.searchPlaceholder')} onPressEnter={onSearch} />
      </div>

      <div className='mt-3 min-h-0 flex-1 overflow-auto overscroll-contain rounded border border-color-border-2'>
        {hits.length === 0 ? (
          <div className='flex h-full items-center justify-center'>
            <Empty description={t('localKb.emptyHits')} />
          </div>
        ) : (
          <div className='divide-y divide-color-border-2'>
            {hits.map((hit, index) => (
              <div key={`${hit.spaceId}-${hit.file}-${hit.lineNo}-${index}`} className='min-w-0 px-3 py-3'>
                <div className='mb-1 flex min-w-0 flex-wrap items-center gap-2'>
                  <Typography.Text className='min-w-0 max-w-full flex-1' bold ellipsis>
                    {hit.title || hit.file}
                  </Typography.Text>
                  <Tag size='small'>{hit.source}</Tag>
                </div>
                <Typography.Text className='mb-2 block break-all text-xs' type='secondary'>
                  {hit.file}
                  {hit.lineNo > 0 ? `:${hit.lineNo}` : ''}
                </Typography.Text>
                <Typography.Paragraph className='mb-0! whitespace-pre-wrap break-words text-sm leading-5'>{hit.text}</Typography.Paragraph>
              </div>
            ))}
          </div>
        )}
      </div>
      <Typography.Text className='mt-2 h-[20px] flex-shrink-0 text-right' type='secondary'>
        {isSearching ? t('localKb.searching') : hits.length > 0 ? t('localKb.hitCount', { count: hits.length }) : ' '}
      </Typography.Text>
    </div>
  );
}

function EntityModal({ isOpen, title, nameLabel, nameValue, descriptionValue, onNameChange, onDescriptionChange, onCancel, onSubmit, submitText }: IEntityModalProps) {
  const { t } = useTranslation();
  return (
    <Modal visible={isOpen} title={title} onCancel={onCancel} onOk={onSubmit} okText={submitText} cancelText={t('localKb.cancel')}>
      <Form layout='vertical'>
        <Form.Item label={nameLabel} required>
          <Input value={nameValue} onChange={onNameChange} />
        </Form.Item>
        <Form.Item label={t('localKb.descriptionLabel')}>
          <Input.TextArea value={descriptionValue} onChange={onDescriptionChange} rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function StatusTag({ value }: { value: string }) {
  const { t } = useTranslation();
  const color = value === 'failed' ? 'red' : value === 'running' || value === 'queued' ? 'arcoblue' : value === 'ready' || value === 'success' ? 'green' : 'gray';
  return (
    <Tag size='small' color={color}>
      {t(`localKb.${value}`, value)}
    </Tag>
  );
}

function ParseTag({ value }: { value: string }) {
  const { t } = useTranslation();
  const color = value === 'failed' ? 'red' : value === 'parsed' ? 'green' : 'gray';
  return (
    <Tag size='small' color={color}>
      {t(`localKb.${value}`, value)}
    </Tag>
  );
}

function BuildProgressPanel({ job, documentCount }: IBuildProgressPanelProps) {
  const { t } = useTranslation();
  const startedAt = job.startedAt ?? job.createdAt;
  const elapsedMs = (job.finishedAt ?? Date.now()) - startedAt;
  return (
    <div className='mt-4 rounded border border-color-border-2 bg-color-fill-1 p-3'>
      <div className='mb-2 flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <Typography.Text bold>{t('localKb.activeBuild')}</Typography.Text>
          <Typography.Text className='block' type='secondary' ellipsis>
            {job.currentStep || t('localKb.waitingBuild')}
          </Typography.Text>
        </div>
        <Tag color='arcoblue'>{job.mode === 'full' ? t('localKb.fullRebuild') : t('localKb.incrementalBuild')}</Tag>
      </div>
      <Progress percent={Math.max(0, Math.min(100, job.progress))} size='small' status={job.status === 'failed' ? 'error' : job.status === 'success' ? 'success' : undefined} />
      <div className='mt-2 flex flex-wrap gap-3'>
        <Typography.Text type='secondary'>
          {t('localKb.elapsed')}: {formatDuration(elapsedMs)}
        </Typography.Text>
        <Typography.Text type='secondary'>{t('localKb.rebuildDocumentCount', { count: documentCount })}</Typography.Text>
        <Typography.Text type='secondary'>
          {t('localKb.startedAt')}: {new Date(startedAt).toLocaleString()}
        </Typography.Text>
      </div>
      <Typography.Text className='mt-2 block' type='secondary'>
        {t('localKb.fullRebuildHint')}
      </Typography.Text>
    </div>
  );
}

function DependencyList({ dependencies, isInstallingEmbedding, embeddingInstallProgress, onInstallEmbeddingModel }: IDependencyListProps) {
  const { t } = useTranslation();
  const isScodeLlmReady = dependencies.scode.installed && dependencies.localLlm.available;
  const isVectorRuntimeReady = dependencies.vectorRuntime.available;
  const isVectorModelReady = dependencies.embeddingModel.installed;
  const rows = [
    [t('localKb.dependencyScodeLlm'), isScodeLlmReady],
    [t('localKb.dependencyLibreOffice'), dependencies.libreOffice.installed],
    [t('localKb.dependencyPoppler'), dependencies.poppler.pdftotext && dependencies.poppler.pdfimages],
  ] as const;
  const vectorModelStatusText = embeddingInstallProgress
    ? t('localKb.installingEmbeddingProgress', {
        phase: t(`localKb.installPhase.${embeddingInstallProgress.phase}`),
        percent: embeddingInstallProgress.percent ?? 0,
      })
    : isVectorModelReady
      ? t('localKb.installed')
      : isVectorRuntimeReady
        ? t('localKb.embeddingModelMissing')
        : t('localKb.runtimeError');
  const vectorModelStatusColor = isVectorModelReady ? 'green' : isInstallingEmbedding ? 'arcoblue' : 'orange';
  const shouldShowInstallEmbedding = !isVectorModelReady && !isInstallingEmbedding;
  return (
    <div className='grid grid-cols-2 gap-2 max-sm:grid-cols-1'>
      {rows.map(([label, isReady]) => (
        <div key={label} className='flex min-h-[38px] items-center justify-between gap-3 rounded border border-color-border-2 px-3 py-2'>
          <Typography.Text>{label}</Typography.Text>
          <Tag color={isReady ? 'green' : 'orange'}>{isReady ? t('localKb.installed') : t('localKb.missing')}</Tag>
        </div>
      ))}
      <div className='flex min-h-[38px] items-center justify-between gap-3 rounded border border-color-border-2 px-3 py-2'>
        <Typography.Text>{t('localKb.dependencyVectorModel')}</Typography.Text>
        {shouldShowInstallEmbedding ? (
          <Button size='mini' onClick={onInstallEmbeddingModel}>
            {t('localKb.installEmbedding')}
          </Button>
        ) : (
          <Tag color={vectorModelStatusColor}>{vectorModelStatusText}</Tag>
        )}
      </div>
    </div>
  );
}

function openCreateSpaceModal(setOpen: (open: boolean) => void, setEditing: (value: ILocalKbSpace | null) => void, setName: (value: string) => void, setDescription: (value: string) => void) {
  setEditing(null);
  setName('');
  setDescription('');
  setOpen(true);
}

function closeEntityModal<T>(setOpen: (open: boolean) => void, setEditing: (value: T | null) => void) {
  setOpen(false);
  setEditing(null);
}

function showError(t: ReturnType<typeof useTranslation>['t'], err: unknown) {
  Message.error(t('localKb.operationFailed', { message: err instanceof Error ? err.message : String(err) }));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours <= 0) return `${minutes}m ${seconds}s`;
  return `${hours}h ${restMinutes}m ${seconds}s`;
}

interface IEntityModalProps {
  isOpen: boolean;
  title: string;
  nameLabel: string;
  nameValue: string;
  descriptionValue: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitText: string;
}

interface IDocumentPanelProps {
  documents: ILocalKbDocument[];
  visibleDocuments: ILocalKbDocument[];
  pagedDocuments: ILocalKbDocument[];
  documentQuery: string;
  documentPage: number;
  documentPageCount: number;
  deletingDocumentId: string | null;
  isBuildLocked: boolean;
  onDocumentQueryChange: (value: string) => void;
  onDocumentPageChange: React.Dispatch<React.SetStateAction<number>>;
  onDeleteDocument: (doc: ILocalKbDocument) => void;
}

interface ISearchPanelProps {
  query: string;
  hits: ILocalKbSearchHit[];
  isSearching: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
}

interface IBuildProgressPanelProps {
  job: ILocalKbBuildJob;
  documentCount: number;
}

interface IDependencyListProps {
  dependencies: ILocalKbDependencyStatus;
  isInstallingEmbedding: boolean;
  embeddingInstallProgress: ILocalKbInstallProgress | null;
  onInstallEmbeddingModel: () => void;
}
