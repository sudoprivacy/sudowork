import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Button, Dropdown, Empty, Form, Input, Menu, Message, Modal, Select, Space, Spin, Table, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MessageSquare, Plus, Save, Upload } from 'lucide-react';
import type { IOntologyConsistencyCheckResult, IOntologyConsistencyIssue, IOntologyWorkbenchSnapshot, IOntologyWorkbenchSummary, IOntologyStudioModel, IOntologyStandardPreview, OntologyStudioPage } from '@sudowork/ontology-common';
import { STUDIO_MAX_FILE_BYTES } from '@sudowork/ontology-common';
import StudioModelEditor from './StudioModelEditor';
import { StudioCapabilitiesPage, StudioChecksPage, StudioDataPage, StudioReleasePage } from './StudioPages';
import type { IOntologyStudioApi } from './api';
import styles from './studio.module.css';

const pages: OntologyStudioPage[] = ['model', 'data', 'capabilities', 'checks', 'release'];
const toModel = (snapshot: IOntologyWorkbenchSnapshot): IOntologyStudioModel => ({ objects: snapshot.objects, relations: snapshot.relations });

export default function OntologyStudio({ api, workspaceId, page = 'model', onNavigate, renderChat }: IOntologyStudioProps) {
  const { t } = useTranslation();
  const text = useCallback((key: string) => t(`ontology.studio.${key}`), [t]);
  const importHint = t('ontology.studio.importFileHint', { maxSize: STUDIO_MAX_FILE_BYTES / (1024 * 1024) });
  const [library, setLibrary] = useState<IOntologyWorkbenchSummary[]>([]);
  const [snapshot, setSnapshot] = useState<IOntologyWorkbenchSnapshot>();
  const [draft, setDraft] = useState<IOntologyStudioModel>({ objects: [], relations: [] });
  const [draftRevision, setDraftRevision] = useState(0);
  const [baseline, setBaseline] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(page === 'model');
  const [contextObjectId, setContextObjectId] = useState<string>();
  const [checkReport, setCheckReport] = useState<IOntologyConsistencyCheckResult>();
  const [focusIssue, setFocusIssue] = useState<IOntologyConsistencyIssue>();
  const [repairConversationId, setRepairConversationId] = useState<string>();
  const [isRepairing, setIsRepairing] = useState(false);
  const [isRepairTracking, setIsRepairTracking] = useState(false);
  const isRepairingRef = useRef(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const isCreatingRef = useRef(false);
  const [createMode, setCreateMode] = useState<'new' | 'rename'>('new');
  const [search, setSearch] = useState('');
  const [filePreview, setPreview] = useState<{ path: string; preview: IOntologyStandardPreview }>();
  const [exporting, setExporting] = useState<{ versionId?: string }>();
  const [exportFormat, setExportFormat] = useState('owl-rdf');
  const [isExportDraft, setIsExportDraft] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    const width = Number(localStorage.getItem('ontology-studio:chat-width') || 35);
    return Number.isFinite(width) ? Math.max(25, Math.min(50, width)) : 35;
  });
  const [createForm] = Form.useForm();
  useEffect(() => {
    localStorage.setItem('ontology-studio:chat-width', String(chatWidth));
  }, [chatWidth]);
  const snapshotRef = useRef(snapshot);
  const isDirty = baseline !== '' && JSON.stringify(draft) !== baseline;
  const isDirtyRef = useRef(isDirty);
  const isEditingRef = useRef(false);
  snapshotRef.current = snapshot;
  isDirtyRef.current = isDirty;
  const onError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const [key, ...details] = message.split(': ');
      Message.error(key.startsWith('ontology.') && t(key) !== key ? `${t(key)}${details.length ? `: ${details.join(': ')}` : ''}` : message);
    },
    [t]
  );
  const onServerSnapshot = useCallback(
    (next: IOntologyWorkbenchSnapshot, isForce = false) => {
      if (next.workspaceId !== workspaceId) return;
      if (snapshotRef.current?.workspaceId === next.workspaceId && (snapshotRef.current.revision || 0) > (next.revision || 0)) return;
      setSnapshot(next);
      if (isForce || (!isDirtyRef.current && !isEditingRef.current)) {
        const model = toModel(next);
        setDraft(structuredClone(model));
        setBaseline(JSON.stringify(model));
        setDraftRevision(next.revision || 0);
      }
    },
    [workspaceId]
  );
  const onEditingChange = useCallback(
    (isEditing: boolean) => {
      isEditingRef.current = isEditing;
      if (!isEditing && !isDirtyRef.current && snapshotRef.current) onServerSnapshot(snapshotRef.current, true);
    },
    [onServerSnapshot]
  );
  const onRefresh = useCallback(async () => {
    if (workspaceId) onServerSnapshot(await api.getWorkbench({ workspaceId }));
    else setLibrary((await api.listWorkbenches()).items);
  }, [api, onServerSnapshot, workspaceId]);
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setSnapshot(undefined);
    setBaseline('');
    setContextObjectId(undefined);
    setCheckReport(undefined);
    setFocusIssue(undefined);
    setRepairConversationId(undefined);
    setIsRepairTracking(false);
    void (
      workspaceId
        ? api.getWorkbench({ workspaceId }).then((next) => {
            if (isCancelled) return;
            setSnapshot(next);
            const model = toModel(next);
            let saved: { revision: number; model: IOntologyStudioModel } | undefined;
            try {
              saved = JSON.parse(localStorage.getItem(`ontology-studio:draft:${workspaceId}`) || 'null') || undefined;
            } catch {
              /* Ignore an unreadable presentation cache. */
            }
            const isValidCache = saved && Array.isArray(saved.model?.objects) && Array.isArray(saved.model?.relations);
            setDraft(isValidCache ? saved!.model : structuredClone(model));
            setDraftRevision(isValidCache ? saved!.revision : next.revision || 0);
            setBaseline(JSON.stringify(model));
          })
        : api.listWorkbenches().then((result) => {
            if (!isCancelled) setLibrary(result.items);
          })
    )
      .catch(onError)
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [api, workspaceId, onError]);
  useEffect(
    () =>
      api.onWorkbenchChanged((next) => {
        onServerSnapshot(next);
        if (!workspaceId) void onRefresh();
      }),
    [api, onServerSnapshot, onRefresh, workspaceId]
  );
  useEffect(() => {
    setIsChatOpen(page === 'model');
  }, [page, workspaceId]);
  useEffect(() => {
    if (!workspaceId || !baseline) return;
    if (isDirty) localStorage.setItem(`ontology-studio:draft:${workspaceId}`, JSON.stringify({ revision: draftRevision, model: draft }));
    else localStorage.removeItem(`ontology-studio:draft:${workspaceId}`);
  }, [workspaceId, draft, isDirty, draftRevision, baseline]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  const onSave = async () => {
    if (!workspaceId) return;
    setIsSaving(true);
    try {
      const next = await api.saveStudioModel({ ...draft, workspaceId, expectedRevision: draftRevision, operationId: crypto.randomUUID() });
      isDirtyRef.current = false;
      onServerSnapshot(next, true);
      Message.success(text('saved'));
    } catch (error) {
      onError(error);
    } finally {
      setIsSaving(false);
    }
  };
  const onReload = () =>
    Modal.confirm({
      title: text('reload'),
      content: text('reloadHint'),
      onOk: async () => {
        if (workspaceId) {
          isDirtyRef.current = false;
          onServerSnapshot(await api.getWorkbench({ workspaceId }), true);
        }
      },
    });
  const onCreate = async () => {
    if (isCreatingRef.current) return;
    const values = await createForm.validate();
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setIsCreating(true);
    try {
      if (createMode === 'rename' && workspaceId) {
        const updated = await api.updateDraft({ workspaceId, title: values.name.trim(), description: values.description });
        onServerSnapshot(updated, true);
        setIsCreateOpen(false);
        return;
      }
      const created = await api.createWorkbench({ name: values.name.trim(), code: `ontology_${crypto.randomUUID().slice(0, 8)}`, description: values.description });
      setIsCreateOpen(false);
      onNavigate(created.snapshot.workspaceId, 'model');
    } catch (error) {
      onError(error);
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
    }
  };
  const onPickImport = async () => {
    try {
      const path = await api.pickStandardFile();
      if (!path) return;
      setIsSaving(true);
      const preview = await api.previewStandardFile({ filePath: path });
      setPreview({ path, ...{ preview } });
    } catch (error) {
      onError(error);
    } finally {
      setIsSaving(false);
    }
  };
  const onImport = async () => {
    if (!filePreview) return;
    setIsSaving(true);
    try {
      const target = snapshot || (await api.createWorkbench({ name: filePreview.preview.fileName.replace(/\.[^.]+$/, ''), code: `ontology_${crypto.randomUUID().slice(0, 8)}` })).snapshot;
      const next = await api.importStandardFile({ workspaceId: target.workspaceId, expectedRevision: target.revision || 0, operationId: crypto.randomUUID(), filePath: filePreview.path, fingerprint: filePreview.preview.fingerprint });
      setPreview(undefined);
      if (workspaceId) onServerSnapshot(next, true);
      else onNavigate(next.workspaceId, 'model');
    } catch (error) {
      onError(error);
    } finally {
      setIsSaving(false);
    }
  };
  const onExport = async () => {
    if (!workspaceId || !snapshot) return;
    try {
      const result = await api.exportStandardFile({ workspaceId, versionId: exporting?.versionId, format: exportFormat === 'owl-xml' ? 'owlxml' : 'rdfxml', ...(isExportDraft && !exporting?.versionId ? { model: draft, expectedRevision: draftRevision } : {}) });
      const url = URL.createObjectURL(new Blob([result.content], { type: 'application/rdf+xml;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${snapshot.draft.title.replace(/[\\/:*?"<>|]/g, '_')}.${exportFormat === 'rdf' ? 'rdf' : 'owl'}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExporting(undefined);
    } catch (error) {
      onError(error);
    }
  };
  const context = useMemo(() => {
    const object = draft.objects.find((item) => item.id === contextObjectId);
    return object ? { id: object.id, name: object.name, iri: object.iri, revision: draftRevision } : undefined;
  }, [draft.objects, contextObjectId, draftRevision]);
  const pageProps = snapshot ? { snapshot, api, onRefresh, onError } : undefined;
  const isConflict = snapshot && isDirty && (snapshot.revision || 0) !== draftRevision;
  const onCheckReport = useCallback(
    (report: IOntologyConsistencyCheckResult) => {
      const current = snapshotRef.current;
      if (current && current.workspaceId === workspaceId) setCheckReport({ ...report, revision: report.revision ?? current.revision ?? 0 });
    },
    [workspaceId]
  );
  useEffect(() => {
    if (!workspaceId || !isRepairTracking || isDirty) return;
    let isCancelled = false;
    const timer = setTimeout(() => {
      void api
        .runConsistencyCheck({ workspaceId })
        .then((report) => {
          if (!isCancelled) onCheckReport(report);
        })
        .catch((error: unknown) => {
          if (!isCancelled) onError(error);
        });
    }, 1500);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [api, workspaceId, isRepairTracking, snapshot?.revision, isDirty, onCheckReport, onError]);
  const onRepair = async (issues: IOntologyConsistencyIssue[]) => {
    if (!snapshot || !issues.length || isRepairingRef.current) return;
    if (isDirty) {
      Message.warning(text('saveBeforeChecks'));
      return;
    }
    const prompt = `${text('repairPrompt')}\n\n${JSON.stringify({ workspaceId: snapshot.workspaceId, ontology: snapshot.draft.title, revision: snapshot.revision || 0, issues }, null, 2)}`;
    if (prompt.length > 80_000) {
      onError(new Error(text('errors.repairTooLarge')));
      return;
    }
    isRepairingRef.current = true;
    setIsRepairing(true);
    setIsChatOpen(true);
    setRepairConversationId(undefined);
    setIsRepairTracking(true);
    try {
      await api.requestAiRepair({ workspaceId: snapshot.workspaceId, title: snapshot.draft.title, prompt }, (id) => {
        if (snapshotRef.current?.workspaceId === snapshot.workspaceId) setRepairConversationId(id);
      });
      Message.success(text('repairSent'));
    } catch (error) {
      setIsRepairTracking(false);
      onError(error);
    } finally {
      isRepairingRef.current = false;
      setIsRepairing(false);
    }
  };
  const onLocateIssue = (issue: IOntologyConsistencyIssue) => {
    if (issue.targetType === 'logic' || issue.targetType === 'action') {
      onNavigate(workspaceId, 'capabilities');
      return;
    }
    if (issue.targetType === 'agent' || issue.targetType === 'version') {
      onNavigate(workspaceId, 'release');
      return;
    }
    setFocusIssue({ ...issue });
    setContextObjectId(issue.targetType === 'relation' ? snapshot?.relations.find((item) => item.id === issue.targetId)?.fromObjectId : issue.targetType === 'quality_rule' ? snapshot?.qualityRules.find((item) => item.id === issue.targetId)?.objectId : issue.targetId);
    onNavigate(workspaceId, 'model');
  };

  return (
    <div className={styles['ontology-studio']}>
      {isLoading ? (
        <div className={styles['ontology-loading']}>
          <Spin />
        </div>
      ) : !workspaceId ? (
        <div className={styles['ontology-library']}>
          <div className={styles['ontology-page-heading']}>
            <div>
              <Typography.Title heading={4}>{text('library')}</Typography.Title>
              <Typography.Text type='secondary'>{text('libraryDescription')}</Typography.Text>
            </div>
            <Space>
              <Tooltip content={importHint} position='bottom' trigger={['hover', 'focus']} style={{ maxWidth: 360 }}>
                <Button icon={<Upload size={16} />} loading={isSaving} onClick={() => void onPickImport()}>
                  {text('import')}
                </Button>
              </Tooltip>
              <Button
                type='primary'
                icon={<Plus size={16} />}
                onClick={() => {
                  createForm.resetFields();
                  setCreateMode('new');
                  setIsCreateOpen(true);
                }}
              >
                {text('newOntology')}
              </Button>
            </Space>
          </div>
          <Input.Search placeholder={text('searchOntology')} value={search} onChange={setSearch} style={{ maxWidth: 360, marginBottom: 24 }} />
          <Table
            rowKey='workspaceId'
            data={library.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()))}
            noDataElement={<Empty description={text('emptyLibrary')} />}
            columns={[
              {
                title: text('name'),
                render: (_value, item) => (
                  <Button type='text' onClick={() => onNavigate(item.workspaceId, 'model')}>
                    {item.name}
                  </Button>
                ),
              },
              { title: text('description'), dataIndex: 'description' },
              { title: text('objects'), dataIndex: 'objectCount' },
              {
                title: text('operations'),
                render: (_value, item) => (
                  <Button
                    type='text'
                    status='danger'
                    onClick={() =>
                      Modal.confirm({
                        title: text('deleteOntology'),
                        content: item.name,
                        onOk: async () => {
                          await api.deleteWorkbench({ workspaceId: item.workspaceId });
                          await onRefresh();
                        },
                      })
                    }
                  >
                    {text('delete')}
                  </Button>
                ),
              },
            ]}
          />
        </div>
      ) : snapshot ? (
        <>
          <header className={styles['ontology-studio-header']}>
            <Space>
              <Button type='text' icon={<ArrowLeft size={17} />} onClick={() => onNavigate()}>
                {text('library')}
              </Button>
              <Typography.Title heading={5}>{snapshot.draft.title}</Typography.Title>
            </Space>
            <Space wrap>
              <Tag color={isDirty ? 'orange' : 'green'}>{text(isDirty ? 'unsaved' : 'saved')}</Tag>
              <Dropdown
                trigger='click'
                droplist={
                  <Menu>
                    <Menu.Item key='import' disabled={isDirty} onClick={() => void onPickImport()}>
                      <Tooltip content={importHint} position='left'>
                        <span>{text('import')}</span>
                      </Tooltip>
                    </Menu.Item>
                    <Menu.Item
                      key='rename'
                      disabled={isDirty}
                      onClick={() => {
                        createForm.resetFields();
                        createForm.setFieldsValue({ name: snapshot.draft.title, description: snapshot.draft.description });
                        setCreateMode('rename');
                        setIsCreateOpen(true);
                      }}
                    >
                      {text('rename')}
                    </Menu.Item>
                    <Menu.Item
                      key='export'
                      onClick={() => {
                        setIsExportDraft(false);
                        setExporting({});
                      }}
                    >
                      {text('export')}
                    </Menu.Item>
                  </Menu>
                }
              >
                <Button>{text('fileMenu')}</Button>
              </Dropdown>
              <Button type='text' icon={<MessageSquare size={16} />} onClick={() => setIsChatOpen((value) => !value)}>
                {text(isChatOpen ? 'hideChat' : 'showChat')}
              </Button>
              <Button type='primary' icon={<Save size={15} />} disabled={!isDirty} loading={isSaving} onClick={() => void onSave()}>
                {text('save')}
              </Button>
            </Space>
          </header>
          <nav className={styles['ontology-studio-nav']} aria-label={text('navigation')}>
            {pages.map((item) => (
              <Button key={item} type={page === item ? 'primary' : 'text'} onClick={() => onNavigate(workspaceId, item)}>
                {text(item)}
              </Button>
            ))}
          </nav>
          {isConflict && (
            <div className={styles['ontology-notice']}>
              {text('conflictHint')}
              <Button type='text' onClick={onReload}>
                {text('reload')}
              </Button>
            </div>
          )}
          <div className={`${styles['ontology-workspace']} ${isChatOpen ? '' : styles['is-chat-collapsed']}`} style={{ '--ontology-chat-width': `${chatWidth}%` } as CSSProperties}>
            <aside className={styles['ontology-chat-pane']} hidden={!isChatOpen}>
              {renderChat(snapshot.workspaceId, snapshot.draft.title, context, repairConversationId)}
            </aside>
            {isChatOpen && (
              <div
                className={styles['ontology-splitter']}
                role='separator'
                aria-label={text('resizeChat')}
                aria-orientation='vertical'
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setChatWidth((value) => Math.max(25, Math.min(50, value + (event.key === 'ArrowLeft' ? -2 : 2))));
                }}
                onPointerDown={(event) => {
                  const parent = event.currentTarget.parentElement!;
                  const target = event.currentTarget;
                  target.setPointerCapture(event.pointerId);
                  const onMove = (move: PointerEvent) => setChatWidth(Math.max(25, Math.min(50, ((move.clientX - parent.getBoundingClientRect().left) / parent.clientWidth) * 100)));
                  const onEnd = () => {
                    target.removeEventListener('pointermove', onMove);
                    target.removeEventListener('pointerup', onEnd);
                  };
                  target.addEventListener('pointermove', onMove);
                  target.addEventListener('pointerup', onEnd);
                }}
              />
            )}
            <main className={styles['ontology-content-pane']}>
              <div className={styles['ontology-page-host']} hidden={page !== 'model'}>
                <StudioModelEditor
                  key={workspaceId}
                  workspaceId={workspaceId}
                  model={draft}
                  document={snapshot.semanticDocument}
                  focusObjectId={contextObjectId}
                  focusIssue={focusIssue}
                  onEditingChange={onEditingChange}
                  onChange={setDraft}
                  onContext={(id) => {
                    setContextObjectId(id);
                    setIsChatOpen(true);
                  }}
                />
              </div>
              {page === 'data' && pageProps && <StudioDataPage {...pageProps} />}
              {page === 'capabilities' && pageProps && <StudioCapabilitiesPage {...pageProps} />}
              {page === 'checks' && pageProps && (
                <StudioChecksPage {...pageProps} report={checkReport} isModelDirty={isDirty} isRepairing={isRepairing} onReport={onCheckReport} onRepair={(issues) => void onRepair(issues)} onLocate={onLocateIssue} onRelease={() => onNavigate(workspaceId, 'release')} />
              )}
              {page === 'release' && pageProps && (
                <StudioReleasePage
                  {...pageProps}
                  isModelDirty={isDirty}
                  onReport={onCheckReport}
                  onViewChecks={() => onNavigate(workspaceId, 'checks')}
                  onExport={(versionId) => {
                    setIsExportDraft(false);
                    setExporting({ versionId });
                  }}
                />
              )}
            </main>
          </div>
        </>
      ) : (
        <Empty description={text('errors.notFound')} />
      )}
      <Modal
        visible={isCreateOpen}
        title={text(createMode === 'rename' ? 'rename' : 'newOntology')}
        onCancel={() => setIsCreateOpen(false)}
        onOk={onCreate}
        confirmLoading={isCreating}
        cancelButtonProps={{ disabled: isCreating }}
        closable={!isCreating}
        maskClosable={!isCreating}
        escToExit={!isCreating}
        unmountOnExit
      >
        <Form form={createForm} layout='vertical'>
          <Form.Item field='name' label={text('name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item field='description' label={text('description')}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
      <Modal visible={!!filePreview} title={text('importPreview')} onCancel={() => setPreview(undefined)} onOk={onImport} confirmLoading={isSaving} okText={text('import')} style={{ width: 'min(780px, 90vw)' }}>
        {filePreview && (
          <>
            <Typography.Text>{filePreview.preview.fileName}</Typography.Text>
            <p>{text('standardPreservation')}</p>
            <Space wrap>
              <Tag>{filePreview.preview.document.sourceFormat}</Tag>
              <Tag>{t('ontology.studio.objectCount', { count: filePreview.preview.model.objects.length })}</Tag>
              <Tag>{t('ontology.studio.statementCount', { count: filePreview.preview.statementCount })}</Tag>
            </Space>
            <Table
              rowKey='id'
              data={filePreview.preview.model.objects}
              columns={[
                { title: text('name'), dataIndex: 'name' },
                { title: 'IRI', dataIndex: 'iri' },
              ]}
            />
            {!!filePreview.preview.document.imports.length && (
              <div className={styles['ontology-notice']}>
                {text('importsUnresolved')}
                <pre>{filePreview.preview.document.imports.join('\n')}</pre>
              </div>
            )}
          </>
        )}
      </Modal>
      <Modal visible={exporting !== undefined} title={text('export')} onCancel={() => setExporting(undefined)} onOk={onExport} okText={text('download')}>
        <div className={styles['ontology-form-stack']}>
          <Typography.Text>{text(exporting?.versionId ? 'publishedVersion' : 'workingDraft')}</Typography.Text>
          <Select
            aria-label={text('format')}
            value={exportFormat}
            onChange={setExportFormat}
            options={[
              { label: '.rdf · RDF/XML', value: 'rdf' },
              { label: '.owl · RDF/XML', value: 'owl-rdf' },
              { label: '.owl · OWL/XML', value: 'owl-xml' },
            ]}
          />
          {isDirty && !exporting?.versionId && (
            <Select
              aria-label={text('exportScope')}
              value={isExportDraft ? 'preview' : 'saved'}
              onChange={(value) => setIsExportDraft(value === 'preview')}
              options={[
                { label: text('savedDraft'), value: 'saved' },
                { label: text('includeUnsaved'), value: 'preview' },
              ]}
            />
          )}
          <Typography.Text type='secondary'>{text('exportDescription')}</Typography.Text>
        </div>
      </Modal>
    </div>
  );
}

export interface IStudioChatContext {
  id: string;
  name: string;
  iri?: string;
  revision: number;
}
interface IOntologyStudioProps {
  renderChat: (workspaceId: string, workspaceName: string, context?: IStudioChatContext, requestedConversationId?: string) => ReactNode;
  api: IOntologyStudioApi;
  workspaceId?: string;
  page?: OntologyStudioPage;
  onNavigate: (workspaceId?: string, page?: OntologyStudioPage) => void;
}
