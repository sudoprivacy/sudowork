import { useState } from 'react';
import { Alert, Button, Empty, Form, Input, Message, Modal, Select, Space, Table, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyWorkbenchSnapshot, IOntologyLogicFunction, IOntologyRuntimeExecution, IOntologyEnvironmentAsset, IOntologyConnectorConfig, IOntologyFunctionParameter, OntologyJsonValue } from '@sudowork/ontology-common';
import { ontologyFieldSignature } from '@sudowork/ontology-common';
import StudioAssetPreview from './StudioAssetPreview';
import StudioDatabaseConnection from './StudioDatabaseConnection';
import styles from './studio.module.css';
import type { IOntologyStudioApi } from './api';

const IMPLEMENTATION_EXAMPLES: Record<IOntologyLogicFunction['runtime'], string> = {
  sql: 'SELECT 1 AS value',
  typescript: "const name = typeof input.name === 'string' ? input.name : '';\nreturn { message: `Hello ${name}` };",
  python: 'name = input.get("name", "")\nresult = {"message": f"Hello {name}"}',
};

function runtimeArgumentTemplate(parameters: IOntologyFunctionParameter[]): Record<string, OntologyJsonValue> {
  return Object.fromEntries(
    parameters.map((parameter): [string, OntologyJsonValue] => {
      const type = parameter.type.trim().toLowerCase();
      if (type === 'number' || type === 'integer') return [parameter.name, 0];
      if (type === 'boolean') return [parameter.name, false];
      if (type === 'array' || type.endsWith('[]')) return [parameter.name, []];
      if (type === 'object' || type.includes('record')) return [parameter.name, {}];
      return [parameter.name, ''];
    })
  );
}

function isJsonRecord(value: unknown): value is Record<string, OntologyJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRuntimeArgumentValue(typeValue: string, value: OntologyJsonValue): boolean {
  const type = typeValue.trim().toLowerCase();
  return (
    type === 'unknown' ||
    type === 'any' ||
    (type === 'string' && typeof value === 'string') ||
    (type === 'number' && typeof value === 'number') ||
    (type === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
    (type === 'boolean' && typeof value === 'boolean') ||
    ((type === 'array' || type.endsWith('[]')) && Array.isArray(value)) ||
    ((type === 'object' || type.includes('record')) && isJsonRecord(value))
  );
}

function isFunctionParameter(value: unknown): value is IOntologyFunctionParameter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const parameter = value as Partial<IOntologyFunctionParameter>;
  return typeof parameter.name === 'string' && !!parameter.name.trim() && typeof parameter.type === 'string' && !!parameter.type.trim() && typeof parameter.required === 'boolean' && (parameter.description === undefined || typeof parameter.description === 'string');
}

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
    const values = await mappingForm.validate().catch((): undefined => undefined);
    if (!values) return;
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
          <Form.Item field='objectId' label={text('object')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: text('object') }) }]}>
            <Select
              options={snapshot.objects.map((object) => ({ label: object.name, value: object.id }))}
              onChange={(value) => {
                setObjectId(value);
                mappingForm.setFieldValue('attributeId', undefined);
              }}
            />
          </Form.Item>
          <Form.Item field='attributeId' label={text('attribute')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: text('attribute') }) }]}>
            <Select options={(snapshot.objects.find((item) => item.id === objectId)?.attributes || []).map((attr) => ({ label: attr.name, value: attr.id }))} />
          </Form.Item>
          <Form.Item field='assetId' label={text('source')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: text('source') }) }]}>
            <Select
              options={snapshot.assets.map((asset) => ({ label: asset.name, value: asset.id }))}
              onChange={(value) => {
                setAssetId(value);
                mappingForm.setFieldValue('fieldName', undefined);
              }}
            />
          </Form.Item>
          <Form.Item field='fieldName' label={text('field')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: text('field') }) }]}>
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
  const [editingRuntime, setEditingRuntime] = useState<IOntologyLogicFunction['runtime']>('sql');
  const [running, setRunning] = useState<IOntologyLogicFunction>();
  const [argumentsText, setArgumentsText] = useState('{}');
  const [argumentError, setArgumentError] = useState('');
  const [result, setResult] = useState<IOntologyRuntimeExecution>();
  const [isBusy, setIsBusy] = useState(false);
  const [form] = Form.useForm();
  const isBuiltInCapability = editing !== undefined && editing !== 'new' && typeof editing.configuration.builtIn === 'string';
  const onOpen = (item?: IOntologyLogicFunction) => {
    const runtime = item?.runtime || 'sql';
    form.resetFields();
    form.setFieldsValue(item ? { ...item, connectorId: item.configuration.connectorId, parameterText: JSON.stringify(item.parameters, null, 2) } : { body: IMPLEMENTATION_EXAMPLES[runtime], parameterText: '[]', objectIds: [], runtime });
    setEditingRuntime(runtime);
    setEditing(item || 'new');
  };
  const onSave = async () => {
    const values = await form.validate().catch((): undefined => undefined);
    if (!values) return;
    try {
      const parameters = JSON.parse(values.parameterText || '[]');
      if (!Array.isArray(parameters) || !parameters.every(isFunctionParameter) || new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) throw new Error(text('invalidParameterDefinition'));
      const prior = editing !== 'new' ? editing : undefined;
      const isBuiltIn = prior && typeof prior.configuration.builtIn === 'string';
      await api.upsertLogicFunction({
        ...prior,
        ...values,
        id: prior?.id,
        code: values.code || prior?.code || `query_${crypto.randomUUID().slice(0, 8)}`,
        name: prior ? prior.name : values.displayName,
        description: prior ? prior.description : values.displayDescription || '',
        displayName: values.displayName,
        displayDescription: values.displayDescription || '',
        body: isBuiltIn ? prior.body : values.body,
        runtime: isBuiltIn ? prior.runtime : values.runtime,
        objectIds: isBuiltIn ? prior.objectIds : values.objectIds,
        parameters: isBuiltIn ? prior.parameters : parameters,
        signature: prior ? prior.signature : values.displayName,
        returnType: 'Rows',
        configuration: isBuiltIn ? prior.configuration : { ...prior?.configuration, connectorId: values.connectorId },
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
    let args: Record<string, OntologyJsonValue>;
    try {
      const parsed = JSON.parse(argumentsText);
      if (!isJsonRecord(parsed)) {
        setArgumentError(text('argumentsMustBeObject'));
        return;
      }
      args = parsed;
    } catch {
      setArgumentError(text('invalidArgumentsJson'));
      return;
    }
    const missing = running.parameters.find((parameter) => parameter.required && (args[parameter.name] === undefined || args[parameter.name] === null));
    if (missing) {
      setArgumentError(t('ontology.studio.argumentRequired', { name: missing.name }));
      return;
    }
    const invalid = running.parameters.find((parameter) => args[parameter.name] !== undefined && args[parameter.name] !== null && !isRuntimeArgumentValue(parameter.type, args[parameter.name]));
    if (invalid) {
      setArgumentError(
        t('ontology.studio.argumentTypeMismatch', {
          name: invalid.name,
          type: invalid.type,
        })
      );
      return;
    }
    setArgumentError('');
    setResult(undefined);
    setIsBusy(true);
    try {
      const output = await api.executeLogicFunction({ id: running.id, arguments: args, workspaceId: snapshot.workspaceId });
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
        scroll={{ x: 760 }}
        columns={[
          { title: text('name'), dataIndex: 'displayName', width: 280 },
          { title: text('runtime'), dataIndex: 'runtime', width: 160 },
          {
            title: text('operations'),
            width: 320,
            render: (_value, item) => (
              <Space>
                <Button type='text' onClick={() => onOpen(item)}>
                  {text('edit')}
                </Button>
                <Button
                  type='text'
                  onClick={() => {
                    setRunning(item);
                    setArgumentsText(JSON.stringify(runtimeArgumentTemplate(item.parameters), null, 2));
                    setArgumentError('');
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
            scroll={{ x: 800 }}
            columns={[
              { title: text('name'), dataIndex: 'displayName', width: 260 },
              { title: text('executor'), dataIndex: 'executor', width: 140 },
              { title: text('description'), dataIndex: 'displayDescription', width: 400 },
            ]}
          />
        </>
      )}
      <Modal visible={editing !== undefined} title={text('editCapability')} onCancel={() => setEditing(undefined)} onOk={onSave} style={{ width: 'min(780px, 90vw)' }} unmountOnExit>
        <Form form={form} layout='vertical'>
          <Form.Item field='displayName' label={text('name')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: text('name') }) }]}>
            <Input />
          </Form.Item>
          <Form.Item field='code' label={text('code')}>
            <Input disabled={isBuiltInCapability} />
          </Form.Item>
          <Form.Item field='displayDescription' label={text('description')}>
            <Input.TextArea />
          </Form.Item>
          <Form.Item field='objectIds' label={text('objects')}>
            <Select disabled={isBuiltInCapability} mode='multiple' options={snapshot.objects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item field='runtime' label={text('runtime')}>
            <Select
              disabled={isBuiltInCapability}
              options={['sql', 'typescript', 'python']}
              onChange={(value) => {
                const runtime = value as IOntologyLogicFunction['runtime'];
                const body = String(form.getFieldValue('body') || '');
                if (!body.trim() || body === IMPLEMENTATION_EXAMPLES[editingRuntime]) form.setFieldValue('body', IMPLEMENTATION_EXAMPLES[runtime]);
                setEditingRuntime(runtime);
              }}
            />
          </Form.Item>
          <Form.Item
            field='connectorId'
            label={text('connection')}
            rules={editingRuntime === 'sql' && !isBuiltInCapability ? [{ required: true, message: t('ontology.studio.requiredField', { field: text('connection') }) }] : []}
            extra={editingRuntime === 'sql' && !isBuiltInCapability ? text('sqlConnectionHint') : undefined}
          >
            <Select disabled={isBuiltInCapability} allowClear options={snapshot.connectors.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item
            field='parameterText'
            label={text('parameters')}
            extra={
              <div className={styles['ontology-field-guide']}>
                <Typography.Text type='secondary'>{text(isBuiltInCapability ? 'builtInParametersHint' : 'parametersHint')}</Typography.Text>
                {!isBuiltInCapability && (
                  <Button
                    type='text'
                    size='mini'
                    onClick={() =>
                      form.setFieldValue(
                        'parameterText',
                        JSON.stringify(
                          [
                            {
                              name: 'name',
                              type: 'string',
                              required: true,
                              description: text('parameterExampleDescription'),
                            },
                          ],
                          null,
                          2
                        )
                      )
                    }
                  >
                    {text('fillParameterExample')}
                  </Button>
                )}
              </div>
            }
          >
            <Input.TextArea disabled={isBuiltInCapability} autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item
            field='body'
            label={text('implementation')}
            rules={isBuiltInCapability ? [] : [{ required: true, message: t('ontology.studio.requiredField', { field: text('implementation') }) }]}
            extra={
              <div className={styles['ontology-field-guide']}>
                <Typography.Text type='secondary'>{isBuiltInCapability ? text('builtInImplementationHint') : t(`ontology.studio.implementationHint.${editingRuntime}`, { placeholder: '{{name}}' })}</Typography.Text>
                {!isBuiltInCapability && (
                  <>
                    <Button type='text' size='mini' onClick={() => form.setFieldValue('body', IMPLEMENTATION_EXAMPLES[editingRuntime])}>
                      {text('fillImplementationExample')}
                    </Button>
                    <pre className={styles['ontology-inline-example']}>{IMPLEMENTATION_EXAMPLES[editingRuntime]}</pre>
                  </>
                )}
              </div>
            }
          >
            <Input.TextArea disabled={isBuiltInCapability} autoSize={{ minRows: 6, maxRows: 14 }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal visible={!!running} title={text('run')} onCancel={() => setRunning(undefined)} onOk={onRun} confirmLoading={isBusy} okText={text('run')} style={{ width: 'min(720px, 92vw)' }}>
        <Alert type='info' content={text('argumentsHint')} className={styles['ontology-run-alert']} />
        {!!running?.parameters.length && (
          <Table
            rowKey='name'
            size='small'
            pagination={false}
            data={running.parameters}
            className={styles['ontology-parameter-table']}
            columns={[
              { title: text('parameterName'), dataIndex: 'name', width: 140 },
              { title: text('parameterType'), dataIndex: 'type', width: 110 },
              {
                title: text('parameterRequirement'),
                width: 90,
                render: (_value, parameter) => <Tag color={parameter.required ? 'orange' : 'gray'}>{text(parameter.required ? 'required' : 'optional')}</Tag>,
              },
              {
                title: text('parameterDescription'),
                render: (_value, parameter) =>
                  parameter.description ||
                  (parameter.objectId
                    ? t('ontology.studio.parameterObjectHint', {
                        object: snapshot.objects.find((object) => object.id === parameter.objectId)?.name || text('object'),
                      })
                    : text('parameterNoDescription')),
              },
            ]}
          />
        )}
        <div className={styles['ontology-run-heading']}>
          <Typography.Text>{text('arguments')}</Typography.Text>
          <Button
            type='text'
            size='mini'
            onClick={() => {
              if (!running) return;
              setArgumentsText(JSON.stringify(runtimeArgumentTemplate(running.parameters), null, 2));
              setArgumentError('');
              setResult(undefined);
            }}
          >
            {text('restoreArgumentExample')}
          </Button>
        </div>
        <Input.TextArea
          aria-label={text('arguments')}
          value={argumentsText}
          onChange={(value) => {
            setArgumentsText(value);
            setArgumentError('');
            setResult(undefined);
          }}
          autoSize={{ minRows: 3, maxRows: 9 }}
        />
        {argumentError && <Alert type='error' content={argumentError} className={styles['ontology-run-alert']} />}
        {result && (
          <>
            <Typography.Title heading={6} className={styles['ontology-run-result-title']}>
              {text('runResult')}
            </Typography.Title>
            <pre className={styles['ontology-code']}>{JSON.stringify(result.output, null, 2)}</pre>
          </>
        )}
      </Modal>
    </section>
  );
}

export { default as StudioChecksPage } from './StudioChecksPage';

export { default as StudioReleasePage } from './StudioReleasePage';

interface IStudioDataPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  api: IOntologyStudioApi;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
}
interface IStudioCapabilitiesPageProps {
  snapshot: IOntologyWorkbenchSnapshot;
  api: IOntologyStudioApi;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
}
