import { useState } from 'react';
import { Button, Empty, Form, Input, Message, Modal, Select, Space, Table, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyWorkbenchSnapshot, IOntologyConsistencyCheckResult, IOntologyLogicFunction, IOntologyRuntimeExecution, IOntologyEnvironmentAsset, IOntologyConnectorConfig } from '@sudowork/ontology-common';
import { ontologyFieldSignature } from '@sudowork/ontology-common';
import StudioAssetPreview from './StudioAssetPreview';
import StudioDatabaseConnection from './StudioDatabaseConnection';
import styles from './studio.module.css';
import type { IOntologyStudioApi } from './api';

export function StudioDataPage({ snapshot, api, onRefresh, onError }: IStudioDataPageProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const [isConnectorOpen, setIsConnectorOpen] = useState(false);
  const [isMappingOpen, setIsMappingOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<string>();
  const [syncingAssetId, setSyncingAssetId] = useState<string>();
  const [scanningConnectorId, setScanningConnectorId] = useState<string>();
  const previewAsset = snapshot.assets.find((asset) => asset.id === previewAssetId);
  const [mappingForm] = Form.useForm();
  const [objectId, setObjectId] = useState<string>();
  const [assetId, setAssetId] = useState<string>();
  const onImport = async () => {
    try {
      const filePaths = await api.pickDataFiles();
      if (!filePaths.length) return;
      setIsBusy(true);
      const sqliteFiles = filePaths.filter((filePath) => /\.(?:db|sqlite|sqlite3|db3)$/i.test(filePath));
      for (const filePath of sqliteFiles) {
        const existing = snapshot.connectors.find((connector) => connector.sourceType === 'sqlite' && connector.path === filePath);
        await api.probeConnector({ workspaceId: snapshot.workspaceId, connector: existing || { name: filePath.split(/[\\/]/).pop() || text('sqliteFiles'), sourceType: 'sqlite', kind: 'database', path: filePath, writable: false, metadata: {} } });
      }
      const dataFiles = filePaths.filter((filePath) => !sqliteFiles.includes(filePath));
      if (dataFiles.length) await api.importFiles({ filePaths: dataFiles, workspaceId: snapshot.workspaceId });
      await onRefresh();
    } catch (error) {
      onError(error);
    } finally {
      setIsBusy(false);
    }
  };
  const onSync = async (asset: IOntologyEnvironmentAsset) => {
    setSyncingAssetId(asset.id);
    try {
      const result = await api.syncAssetSchema({ id: asset.id, workspaceId: snapshot.workspaceId });
      const updated = result.assets.find((item) => item.id === asset.id);
      if (!updated) throw new Error(text('dataErrors.schemaUnavailable'));
      const previous = new Map(asset.fields.map((field) => [field.name, field]));
      const current = new Set(updated.fields.map((field) => field.name));
      const added = updated.fields.filter((field) => !previous.has(field.name)).length;
      const removed = asset.fields.filter((field) => !current.has(field.name)).length;
      const changed = updated.fields.filter((field) => previous.has(field.name) && ontologyFieldSignature(previous.get(field.name)!) !== ontologyFieldSignature(field)).length;
      await onRefresh();
      Message.success(t(added || removed || changed ? 'ontology.studio.syncComplete' : 'ontology.studio.syncUnchanged', { count: updated.fields.length, added, removed, changed }));
    } catch (error) {
      onError(error);
    } finally {
      setSyncingAssetId(undefined);
    }
  };
  const onRescan = async (connector: IOntologyConnectorConfig) => {
    setScanningConnectorId(connector.id);
    try {
      const result = await api.probeConnector({ workspaceId: snapshot.workspaceId, connector });
      await onRefresh();
      Message.success(t('ontology.studio.connectionRescanned', { count: result.assets.length }));
    } catch (error) {
      onError(error);
    } finally {
      setScanningConnectorId(undefined);
    }
  };
  const onSaveMapping = async () => {
    const values = await mappingForm.validate();
    try {
      await api.upsertMapping({ ...values, workspaceId: snapshot.workspaceId, strategy: 'manual', status: 'approved' });
      await onRefresh();
      setIsMappingOpen(false);
    } catch (error) {
      onError(error);
    }
  };
  return (
    <section className={styles['ontology-page']}>
      <div className={styles['ontology-page-heading']}>
        <div>
          <Typography.Title heading={5}>{text('dataTitle')}</Typography.Title>
          <Typography.Text type='secondary'>{text('dataDescription')}</Typography.Text>
        </div>
        <Space wrap>
          <Tooltip content={text('addFilesHint')} position='bottom' trigger={['hover', 'focus']} style={{ maxWidth: 360 }}>
            <Button loading={isBusy} onClick={() => void onImport()}>
              {text('addFiles')}
            </Button>
          </Tooltip>
          <Button
            onClick={() => {
              setIsConnectorOpen(true);
            }}
          >
            {text('addConnection')}
          </Button>
          <Button
            type='primary'
            disabled={!snapshot.assets.length || !snapshot.objects.length}
            onClick={() => {
              mappingForm.resetFields();
              setObjectId(undefined);
              setAssetId(undefined);
              setIsMappingOpen(true);
            }}
          >
            {text('addMapping')}
          </Button>
        </Space>
      </div>
      {!!snapshot.connectors.length && (
        <>
          <Typography.Title heading={6}>{text('dataConnections')}</Typography.Title>
          <Table
            rowKey='id'
            data={snapshot.connectors}
            pagination={false}
            columns={[
              { title: text('name'), dataIndex: 'name' },
              { title: text('kind'), render: (_value, connector) => (connector.sourceType === 'sqlite' ? 'SQLite' : connector.sourceType === 'mysql' ? 'MySQL' : connector.sourceType === 'postgresql' ? 'PostgreSQL' : connector.sourceType) },
              { title: text('databaseLocation'), render: (_value, connector) => (connector.sourceType === 'sqlite' ? connector.path : connector.database || connector.host || connector.name) },
              {
                title: text('operations'),
                render: (_value, connector) => (
                  <Button type='text' loading={scanningConnectorId === connector.id} disabled={!!scanningConnectorId && scanningConnectorId !== connector.id} onClick={() => void onRescan(connector)}>
                    {text('rescanConnection')}
                  </Button>
                ),
              },
            ]}
          />
          <Typography.Title heading={6}>{text('dataSources')}</Typography.Title>
        </>
      )}
      <Table
        rowKey='id'
        data={snapshot.assets}
        noDataElement={<Empty description={text('emptyData')} />}
        columns={[
          {
            title: text('name'),
            render: (_value, record) => (
              <Space>
                {record.name}
                {record.metadata.sourceMissing && <Tag color='red'>{text('sourceMissing')}</Tag>}
              </Space>
            ),
          },
          { title: text('source'), dataIndex: 'sourceName' },
          { title: text('kind'), render: (_value, record) => t(`ontology.assetKind.${record.kind}`) },
          { title: text('fields'), render: (_value, record) => record.fields.length },
          { title: text('lastSynced'), render: (_value, record) => (record.metadata.schemaSyncedAt ? new Date(Number(record.metadata.schemaSyncedAt)).toLocaleString() : text('notSynced')) },
          {
            title: text('operations'),
            render: (_value, record) => (
              <Space>
                <Button
                  type='text'
                  onClick={() => {
                    setPreviewAssetId(record.id);
                  }}
                >
                  {text('preview')}
                </Button>
                <Button type='text' loading={syncingAssetId === record.id} disabled={!!syncingAssetId && syncingAssetId !== record.id} onClick={() => void onSync(record)}>
                  {text('sync')}
                </Button>
                <Button
                  type='text'
                  status='danger'
                  onClick={() => {
                    Modal.confirm({
                      title: text('delete'),
                      content: record.name,
                      onOk: async () => {
                        await api.deleteAsset({ id: record.id, workspaceId: snapshot.workspaceId });
                        await onRefresh();
                      },
                    });
                  }}
                >
                  {text('delete')}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Typography.Title heading={6}>{text('mappings')}</Typography.Title>
      <Table
        rowKey='id'
        data={snapshot.mappings}
        columns={[
          { title: text('object'), render: (_value, item) => snapshot.objects.find((object) => object.id === item.objectId)?.name },
          { title: text('attribute'), render: (_value, item) => snapshot.objects.find((object) => object.id === item.objectId)?.attributes.find((attr) => attr.id === item.attributeId)?.name },
          { title: text('source'), render: (_value, item) => snapshot.assets.find((asset) => asset.id === item.assetId)?.name },
          { title: text('field'), dataIndex: 'fieldName' },
          {
            title: text('operations'),
            render: (_value, item) => (
              <Button
                type='text'
                status='danger'
                onClick={() => {
                  void api.deleteMapping({ id: item.id, workspaceId: snapshot.workspaceId }).then(onRefresh).catch(onError);
                }}
              >
                {text('delete')}
              </Button>
            ),
          },
        ]}
      />
      {isConnectorOpen && <StudioDatabaseConnection workspaceId={snapshot.workspaceId} api={api} onRefresh={onRefresh} onError={onError} onClose={() => setIsConnectorOpen(false)} />}
      <Modal visible={isMappingOpen} title={text('addMapping')} onCancel={() => setIsMappingOpen(false)} onOk={onSaveMapping} unmountOnExit>
        <Form form={mappingForm} layout='vertical'>
          <Form.Item field='objectId' label={text('object')} rules={[{ required: true }]}>
            <Select
              options={snapshot.objects.map((object) => ({ label: object.name, value: object.id }))}
              onChange={(value) => {
                setObjectId(value);
                mappingForm.setFieldValue('attributeId', undefined);
              }}
            />
          </Form.Item>
          <Form.Item field='attributeId' label={text('attribute')} rules={[{ required: true }]}>
            <Select options={(snapshot.objects.find((item) => item.id === objectId)?.attributes || []).map((attr) => ({ label: attr.name, value: attr.id }))} />
          </Form.Item>
          <Form.Item field='assetId' label={text('source')} rules={[{ required: true }]}>
            <Select
              options={snapshot.assets.map((asset) => ({ label: asset.name, value: asset.id }))}
              onChange={(value) => {
                setAssetId(value);
                mappingForm.setFieldValue('fieldName', undefined);
              }}
            />
          </Form.Item>
          <Form.Item field='fieldName' label={text('field')} rules={[{ required: true }]}>
            <Select options={(snapshot.assets.find((item) => item.id === assetId)?.fields || []).map((field) => field.name)} />
          </Form.Item>
        </Form>
      </Modal>
      {previewAsset && <StudioAssetPreview key={`${snapshot.workspaceId}:${previewAsset.id}`} asset={previewAsset} workspaceId={snapshot.workspaceId} api={api} isSyncing={syncingAssetId === previewAsset.id} onSync={onSync} onRefresh={onRefresh} onClose={() => setPreviewAssetId(undefined)} />}
    </section>
  );
}

export function StudioCapabilitiesPage({ snapshot, api, onRefresh, onError }: IStudioCapabilitiesPageProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const [editing, setEditing] = useState<IOntologyLogicFunction | 'new'>();
  const [running, setRunning] = useState<IOntologyLogicFunction>();
  const [argumentsText, setArgumentsText] = useState('{}');
  const [result, setResult] = useState<IOntologyRuntimeExecution>();
  const [isBusy, setIsBusy] = useState(false);
  const [form] = Form.useForm();
  const onOpen = (item?: IOntologyLogicFunction) => {
    form.resetFields();
    form.setFieldsValue(item ? { ...item, connectorId: item.configuration.connectorId, parameterText: JSON.stringify(item.parameters, null, 2) } : { body: 'SELECT 1 AS value', parameterText: '[]', objectIds: [], runtime: 'sql' });
    setEditing(item || 'new');
  };
  const onSave = async () => {
    const values = await form.validate();
    try {
      const parameters = JSON.parse(values.parameterText || '[]');
      if (!Array.isArray(parameters)) throw new Error(text('invalidJson'));
      const prior = editing !== 'new' ? editing : undefined;
      await api.upsertLogicFunction({
        ...prior,
        ...values,
        id: prior?.id,
        code: values.code || prior?.code || `query_${crypto.randomUUID().slice(0, 8)}`,
        parameters,
        signature: values.name,
        returnType: 'Rows',
        configuration: { ...prior?.configuration, connectorId: values.connectorId },
        status: 'active',
        workspaceId: snapshot.workspaceId,
      });
      await onRefresh();
      setEditing(undefined);
    } catch (error) {
      onError(error);
    }
  };
  const onRun = async () => {
    if (!running) return;
    setIsBusy(true);
    try {
      const output = await api.executeLogicFunction({ id: running.id, arguments: JSON.parse(argumentsText), workspaceId: snapshot.workspaceId });
      setResult(output.execution);
      await onRefresh();
    } catch (error) {
      onError(error);
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <section className={styles['ontology-page']}>
      <div className={styles['ontology-page-heading']}>
        <div>
          <Typography.Title heading={5}>{text('capabilitiesTitle')}</Typography.Title>
          <Typography.Text type='secondary'>{text('capabilitiesDescription')}</Typography.Text>
        </div>
        <Button type='primary' onClick={() => onOpen()}>
          {text('addCapability')}
        </Button>
      </div>
      <Table
        rowKey='id'
        data={snapshot.logicFunctions}
        noDataElement={<Empty description={text('emptyCapabilities')} />}
        columns={[
          { title: text('name'), dataIndex: 'name' },
          { title: text('runtime'), dataIndex: 'runtime' },
          {
            title: text('operations'),
            render: (_value, item) => (
              <Space>
                <Button type='text' onClick={() => onOpen(item)}>
                  {text('edit')}
                </Button>
                <Button
                  type='text'
                  onClick={() => {
                    setRunning(item);
                    setArgumentsText(JSON.stringify(Object.fromEntries(item.parameters.map((parameter) => [parameter.name, ''])), null, 2));
                    setResult(undefined);
                  }}
                >
                  {text('run')}
                </Button>
                <Button
                  type='text'
                  status='danger'
                  onClick={() => {
                    void api.deleteLogicFunction({ id: item.id, workspaceId: snapshot.workspaceId }).then(onRefresh).catch(onError);
                  }}
                >
                  {text('delete')}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      {!!snapshot.actions.length && (
        <>
          <Typography.Title heading={6}>{text('actions')}</Typography.Title>
          <Table
            rowKey='id'
            data={snapshot.actions}
            columns={[
              { title: text('name'), dataIndex: 'name' },
              { title: text('executor'), dataIndex: 'executor' },
              { title: text('description'), dataIndex: 'description' },
            ]}
          />
        </>
      )}
      <Modal visible={editing !== undefined} title={text('editCapability')} onCancel={() => setEditing(undefined)} onOk={onSave} style={{ width: 'min(780px, 90vw)' }} unmountOnExit>
        <Form form={form} layout='vertical'>
          <Form.Item field='name' label={text('name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item field='code' label={text('code')}>
            <Input />
          </Form.Item>
          <Form.Item field='description' label={text('description')}>
            <Input.TextArea />
          </Form.Item>
          <Form.Item field='objectIds' label={text('objects')}>
            <Select mode='multiple' options={snapshot.objects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item field='runtime' label={text('runtime')}>
            <Select options={['sql', 'typescript', 'python']} />
          </Form.Item>
          <Form.Item field='connectorId' label={text('connection')}>
            <Select allowClear options={snapshot.connectors.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item field='parameterText' label={text('parameters')}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item field='body' label={text('implementation')} rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 6, maxRows: 14 }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal visible={!!running} title={text('run')} onCancel={() => setRunning(undefined)} onOk={onRun} confirmLoading={isBusy} okText={text('run')}>
        <Input.TextArea aria-label={text('arguments')} value={argumentsText} onChange={setArgumentsText} autoSize={{ minRows: 3, maxRows: 9 }} />
        {result && <pre className={styles['ontology-code']}>{JSON.stringify(result.output, null, 2)}</pre>}
      </Modal>
    </section>
  );
}

export function StudioChecksPage({ snapshot, api, onError, onLocate }: IStudioChecksPageProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const [result, setResult] = useState<{ revision: number; check: IOntologyConsistencyCheckResult }>();
  const [isChecking, setIsChecking] = useState(false);
  const onCheck = async () => {
    setIsChecking(true);
    try {
      setResult({ revision: snapshot.revision || 0, check: await api.runConsistencyCheck({ workspaceId: snapshot.workspaceId }) });
    } catch (error) {
      onError(error);
    } finally {
      setIsChecking(false);
    }
  };
  const isStale = result && result.revision !== (snapshot.revision || 0);
  return (
    <section className={styles['ontology-page']}>
      <div className={styles['ontology-page-heading']}>
        <div>
          <Typography.Title heading={5}>{text('checksTitle')}</Typography.Title>
          <Typography.Text type='secondary'>{text('checksDescription')}</Typography.Text>
        </div>
        <Button type='primary' loading={isChecking} onClick={() => void onCheck()}>
          {text('runChecks')}
        </Button>
      </div>
      {snapshot.semanticDocument?.imports.length ? (
        <div className={styles['ontology-notice']}>
          {text('importsUnresolved')}
          <ul>
            {snapshot.semanticDocument.imports.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result ? (
        <>
          <Tag color={isStale ? 'orange' : result.check.isValid ? 'green' : 'red'}>{text(isStale ? 'staleReport' : result.check.isValid ? 'checksPassed' : 'checksFailed')}</Tag>
          <Table
            rowKey='id'
            data={result.check.issues}
            columns={[
              { title: text('severity'), dataIndex: 'severity' },
              { title: text('description'), dataIndex: 'message' },
              {
                title: text('operations'),
                render: (_value, issue) => (
                  <Button type='text' onClick={() => onLocate(issue.targetId)}>
                    {text('locate')}
                  </Button>
                ),
              },
            ]}
          />
          <pre className={styles['ontology-code']}>{JSON.stringify(result.check.qualityRuleResults || [], null, 2)}</pre>
        </>
      ) : (
        <Empty description={text('noChecks')} />
      )}
    </section>
  );
}

export { default as StudioReleasePage } from './StudioReleasePage';

interface IStudioDataPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  api: IOntologyStudioApi;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
}
interface IStudioChecksPageProps extends IStudioDataPageProps {
  onLocate: (objectId?: string) => void;
}

interface IStudioCapabilitiesPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  api: IOntologyStudioApi;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
}
