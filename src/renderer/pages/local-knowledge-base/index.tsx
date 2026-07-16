import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Divider, Empty, Form, Input, List, Message, Modal, Progress, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { BookOpen, Edit3, FileText, Folder, FolderPlus, Play, Plus, RefreshCw, Search, Settings, Trash2 } from 'lucide-react';
import { ipcBridge } from '@/common';
import type { ILocalKbBuildJob, ILocalKbCategory, ILocalKbDependencyStatus, ILocalKbDocument, ILocalKbInstallProgress, ILocalKbSearchHit, ILocalKbSpace } from '@/common/types/localKnowledgeBase';

export default function LocalKnowledgeBasePage() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<ILocalKbCategory[]>([]);
  const [spaces, setSpaces] = useState<ILocalKbSpace[]>([]);
  const [documents, setDocuments] = useState<ILocalKbDocument[]>([]);
  const [jobs, setJobs] = useState<ILocalKbBuildJob[]>([]);
  const [dependencies, setDependencies] = useState<ILocalKbDependencyStatus | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isQueueingBuild, setIsQueueingBuild] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isSpaceModalOpen, setIsSpaceModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ILocalKbCategory | null>(null);
  const [editingSpace, setEditingSpace] = useState<ILocalKbSpace | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ILocalKbSearchHit[]>([]);
  const [isInstallingEmbedding, setIsInstallingEmbedding] = useState(false);
  const [embeddingInstallProgress, setEmbeddingInstallProgress] = useState<ILocalKbInstallProgress | null>(null);

  const selectedSpace = useMemo(() => spaces.find((space) => space.id === selectedSpaceId) ?? null, [selectedSpaceId, spaces]);
  const visibleSpaces = useMemo(() => (selectedCategoryId ? spaces.filter((space) => space.categoryId === selectedCategoryId) : spaces), [selectedCategoryId, spaces]);
  const activeJob = useMemo(() => jobs.find((job) => job.status === 'running' || job.status === 'queued') ?? null, [jobs]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [categoryRes, spaceRes, depRes] = await Promise.all([ipcBridge.localKnowledgeBase.listCategories.invoke(), ipcBridge.localKnowledgeBase.listSpaces.invoke(undefined), ipcBridge.localKnowledgeBase.getDependencyStatus.invoke()]);
      if (!categoryRes.success || !spaceRes.success || !depRes.success) {
        throw new Error(categoryRes.msg || spaceRes.msg || depRes.msg);
      }
      setCategories(categoryRes.data ?? []);
      setSpaces(spaceRes.data ?? []);
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
    if (!selectedSpaceId) return;
    const timer = window.setInterval(() => {
      void refreshSpaceDetail();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshSpaceDetail, selectedSpaceId]);

  const onSubmitCategory = async () => {
    const name = nameValue.trim();
    if (!name) {
      Message.error(t('localKb.nameRequired'));
      return;
    }
    const input = { name, description: descriptionValue.trim() || null };
    const res = editingCategory ? await ipcBridge.localKnowledgeBase.updateCategory.invoke({ id: editingCategory.id, updates: input }) : await ipcBridge.localKnowledgeBase.createCategory.invoke(input);
    if (!res.success) {
      Message.error(t('localKb.operationFailed', { message: res.msg }));
      return;
    }
    Message.success(t(editingCategory ? 'localKb.updateCategorySuccess' : 'localKb.createCategorySuccess'));
    setIsCategoryModalOpen(false);
    setEditingCategory(null);
    setNameValue('');
    setDescriptionValue('');
    await refresh();
  };

  const onSubmitSpace = async () => {
    const name = nameValue.trim();
    if (!name) {
      Message.error(t('localKb.nameRequired'));
      return;
    }
    const input = { categoryId: editingSpace ? editingSpace.categoryId : selectedCategoryId, name, description: descriptionValue.trim() || null };
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

  const onEditCategory = (category: ILocalKbCategory) => {
    setEditingCategory(category);
    setNameValue(category.name);
    setDescriptionValue(category.description ?? '');
    setIsCategoryModalOpen(true);
  };

  const onDeleteCategory = (category: ILocalKbCategory) => {
    Modal.confirm({
      title: t('localKb.deleteCategoryTitle'),
      content: t('localKb.deleteCategoryContent', { name: category.name }),
      okText: t('localKb.delete'),
      cancelText: t('localKb.cancel'),
      onOk: async () => {
        const res = await ipcBridge.localKnowledgeBase.deleteCategory.invoke({ id: category.id });
        if (!res.success) {
          Message.error(t('localKb.operationFailed', { message: res.msg }));
          return;
        }
        Message.success(t('localKb.deleteCategorySuccess'));
        if (selectedCategoryId === category.id) setSelectedCategoryId(null);
        await refresh();
      },
    });
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
    const res = await ipcBridge.localKnowledgeBase.search.invoke({ spaceId: selectedSpaceId, query });
    if (!res.success) {
      Message.error(t('localKb.operationFailed', { message: res.msg }));
      return;
    }
    setHits(res.data?.hits ?? []);
  };

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
    <div className='h-full overflow-auto bg-color-bg-1 p-4'>
      <div className='mb-4 flex items-center justify-between gap-3'>
        <div>
          <Typography.Title heading={4} className='mb-1! flex items-center gap-2'>
            <BookOpen size={20} />
            {t('localKb.title')}
          </Typography.Title>
          <Typography.Text type='secondary'>{t('localKb.description')}</Typography.Text>
        </div>
        <Button icon={<RefreshCw size={16} />} onClick={() => void refresh()}>
          {t('localKb.refresh')}
        </Button>
      </div>

      <Spin loading={isLoading} className='w-full'>
        <div className='grid grid-cols-[320px_1fr] gap-4'>
          <Card className='h-[calc(100vh-150px)] overflow-auto' bordered>
            <div className='mb-3 flex items-center justify-between'>
              <Typography.Text bold>{t('localKb.categories')}</Typography.Text>
              <Button size='mini' icon={<FolderPlus size={14} />} onClick={() => openCreateCategoryModal(setIsCategoryModalOpen, setEditingCategory, setNameValue, setDescriptionValue)}>
                {t('localKb.newCategory')}
              </Button>
            </div>
            <Button className='mb-2 w-full justify-start' type={selectedCategoryId === null ? 'primary' : 'secondary'} onClick={() => setSelectedCategoryId(null)}>
              {t('localKb.allSpaces')}
            </Button>
            {categories.length === 0 ? (
              <Empty description={t('localKb.emptyCategory')} />
            ) : (
              <List
                size='small'
                dataSource={categories}
                render={(category) => (
                  <List.Item key={category.id} className='cursor-pointer' onClick={() => setSelectedCategoryId(category.id)}>
                    <div className='flex w-full items-center justify-between gap-2'>
                      <Space className='min-w-0'>
                        <Folder size={16} />
                        <Typography.Text bold={selectedCategoryId === category.id} ellipsis>
                          {category.name}
                        </Typography.Text>
                      </Space>
                      <div className='flex items-center gap-1' onClick={(event) => event.stopPropagation()}>
                        <Button size='mini' type='text' icon={<Edit3 size={13} />} onClick={() => onEditCategory(category)} />
                        <Button size='mini' type='text' status='danger' icon={<Trash2 size={13} />} onClick={() => onDeleteCategory(category)} />
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}

            <Divider />

            <div className='mb-3 flex items-center justify-between'>
              <Typography.Text bold>{t('localKb.spaces')}</Typography.Text>
              <Button size='mini' icon={<Plus size={14} />} onClick={() => openCreateSpaceModal(setIsSpaceModalOpen, setEditingSpace, setNameValue, setDescriptionValue)}>
                {t('localKb.newSpace')}
              </Button>
            </div>
            {visibleSpaces.length === 0 ? (
              <Empty description={t('localKb.emptySpace')} />
            ) : (
              <List
                size='small'
                dataSource={visibleSpaces}
                render={(space) => (
                  <List.Item key={space.id} className='cursor-pointer' onClick={() => setSelectedSpaceId(space.id)}>
                    <div className='flex w-full items-start justify-between gap-2'>
                      <div className='min-w-0'>
                        <Space className='min-w-0'>
                          <BookOpen size={16} />
                          <Typography.Text bold={selectedSpaceId === space.id} ellipsis>
                            {space.name}
                          </Typography.Text>
                        </Space>
                        <div className='mt-1 flex gap-1'>
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

          <div className='min-w-0 space-y-4'>
            {!selectedSpace ? (
              <Card>
                <Empty description={t('localKb.emptySpace')} />
              </Card>
            ) : (
              <>
                <Card>
                  <div className='flex items-start justify-between gap-4'>
                    <div className='min-w-0'>
                      <Typography.Title heading={5} className='mb-1!'>
                        {selectedSpace.name}
                      </Typography.Title>
                      <Typography.Text type='secondary'>{selectedSpace.description || t('localKb.description')}</Typography.Text>
                      <div className='mt-3 flex flex-wrap gap-2'>
                        <StatusTag value={selectedSpace.buildStatus} />
                        <Tag>{selectedSpace.retrievalMode === 'hybrid' ? t('localKb.hybrid') : t('localKb.grepOnly')}</Tag>
                        <Tag>{selectedSpace.lastBuiltAt ? new Date(selectedSpace.lastBuiltAt).toLocaleString() : t('localKb.neverBuilt')}</Tag>
                      </div>
                    </div>
                    <Space>
                      <Button icon={<Edit3 size={16} />} disabled={selectedSpace.buildStatus === 'queued' || selectedSpace.buildStatus === 'running'} onClick={() => onEditSpace(selectedSpace)}>
                        {t('localKb.edit')}
                      </Button>
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
                  {selectedSpace.lastBuildError && <Typography.Text type='error'>{selectedSpace.lastBuildError}</Typography.Text>}
                  {activeJob && <BuildProgressPanel job={activeJob} documentCount={documents.filter((doc) => doc.parseStatus === 'parsed').length} />}
                </Card>

                <div className='grid grid-cols-2 gap-4'>
                  <Card title={t('localKb.documents')}>
                    {documents.length === 0 ? (
                      <Empty description={t('localKb.emptyDocuments')} />
                    ) : (
                      <List
                        size='small'
                        dataSource={documents}
                        render={(doc) => (
                          <List.Item key={doc.id}>
                            <div className='min-w-0 flex-1'>
                              <Typography.Text ellipsis>{doc.relativePath || doc.fileName}</Typography.Text>
                              <div className='mt-1 flex gap-2'>
                                <Tag size='small'>{formatSize(doc.sizeBytes)}</Tag>
                                <ParseTag value={doc.parseStatus} />
                              </div>
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>

                  <Card title={t('localKb.jobs')}>
                    {jobs.length === 0 ? (
                      <Empty description={t('localKb.emptyJobs')} />
                    ) : (
                      <List
                        size='small'
                        dataSource={jobs}
                        render={(job) => (
                          <List.Item key={job.id}>
                            <div className='w-full'>
                              <div className='flex items-center justify-between'>
                                <StatusTag value={job.status} />
                                <Typography.Text type='secondary'>{new Date(job.createdAt).toLocaleString()}</Typography.Text>
                              </div>
                              <Typography.Text type='secondary'>{job.currentStep || `${job.progress}%`}</Typography.Text>
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
                              {job.errorMessage && <Typography.Text type='error'>{job.errorMessage}</Typography.Text>}
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>
                </div>

                <div className='grid grid-cols-2 gap-4'>
                  <Card
                    title={
                      <span className='flex items-center gap-2'>
                        <Settings size={16} />
                        {t('localKb.dependencies')}
                      </span>
                    }
                  >
                    {dependencies && <DependencyList dependencies={dependencies} isInstallingEmbedding={isInstallingEmbedding} embeddingInstallProgress={embeddingInstallProgress} onInstallEmbeddingModel={() => void onInstallEmbeddingModel()} />}
                  </Card>
                  <Card
                    title={
                      <span className='flex items-center gap-2'>
                        <Search size={16} />
                        {t('localKb.search')}
                      </span>
                    }
                  >
                    <Space className='mb-3 w-full'>
                      <Input value={query} onChange={setQuery} placeholder={t('localKb.searchPlaceholder')} onPressEnter={() => void onSearch()} />
                      <Button type='primary' onClick={() => void onSearch()}>
                        {t('localKb.runSearch')}
                      </Button>
                    </Space>
                    {hits.length === 0 ? (
                      <Empty description={t('localKb.emptyHits')} />
                    ) : (
                      <List
                        size='small'
                        dataSource={hits}
                        render={(hit) => (
                          <List.Item>
                            <div>
                              <Typography.Text bold>{hit.title}</Typography.Text>
                              <Typography.Text type='secondary'>
                                {' '}
                                {hit.file}:{hit.lineNo}
                              </Typography.Text>
                              <Typography.Paragraph className='mb-0!'>{hit.text}</Typography.Paragraph>
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>
      </Spin>

      <EntityModal
        isOpen={isCategoryModalOpen}
        title={editingCategory ? t('localKb.editCategory') : t('localKb.newCategory')}
        nameLabel={t('localKb.categoryName')}
        nameValue={nameValue}
        descriptionValue={descriptionValue}
        onNameChange={setNameValue}
        onDescriptionChange={setDescriptionValue}
        onCancel={() => closeEntityModal(setIsCategoryModalOpen, setEditingCategory)}
        onSubmit={() => void onSubmitCategory()}
        submitText={editingCategory ? t('localKb.save') : t('localKb.create')}
      />
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
  const rows = [
    [t('localKb.dependencyScode'), dependencies.scode.installed],
    [t('localKb.dependencyLocalLlm'), dependencies.localLlm.available],
    [t('localKb.dependencyLibreOffice'), dependencies.libreOffice.installed],
    [t('localKb.dependencyVector'), dependencies.vectorRuntime.available],
    [t('localKb.dependencyPoppler'), dependencies.poppler.pdftotext && dependencies.poppler.pdfimages],
  ] as const;
  return (
    <div className='space-y-2'>
      <div className='grid grid-cols-2 gap-2'>
        {rows.map(([label, isReady]) => (
          <div key={label} className='flex items-center justify-between rounded border border-color-border-2 px-3 py-2'>
            <Typography.Text>{label}</Typography.Text>
            <Tag color={isReady ? 'green' : 'orange'}>{isReady ? t('localKb.installed') : t('localKb.missing')}</Tag>
          </div>
        ))}
      </div>
      <div className='flex items-center justify-between gap-3 rounded border border-color-border-2 px-3 py-2'>
        <div className='min-w-0'>
          <Typography.Text>{t('localKb.dependencyEmbedding')}</Typography.Text>
          <Typography.Text className='block' type='secondary' ellipsis>
            {embeddingInstallProgress
              ? t('localKb.installingEmbeddingProgress', {
                  phase: t(`localKb.installPhase.${embeddingInstallProgress.phase}`),
                  percent: embeddingInstallProgress.percent ?? 0,
                })
              : dependencies.embeddingModel.path}
          </Typography.Text>
        </div>
        {dependencies.embeddingModel.installed ? (
          <Tag color='green'>{t('localKb.installed')}</Tag>
        ) : (
          <Button size='small' loading={isInstallingEmbedding} onClick={onInstallEmbeddingModel}>
            {t('localKb.installEmbedding')}
          </Button>
        )}
      </div>
    </div>
  );
}

function openCreateCategoryModal(setOpen: (open: boolean) => void, setEditing: (value: ILocalKbCategory | null) => void, setName: (value: string) => void, setDescription: (value: string) => void) {
  setEditing(null);
  setName('');
  setDescription('');
  setOpen(true);
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
