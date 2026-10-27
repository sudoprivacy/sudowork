import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Message, Modal, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyRuntimeEnvironment, IOntologyRuntimeBindings, IOntologyPackageResource, IOntologyConnectorConfig } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';
import StudioDatabaseConnection from './StudioDatabaseConnection';

export default function StudioRuntimeEnvironment({ workspaceId, revision, api, onRefresh, onError, workbenchApi, connectors = [] }: IStudioRuntimeEnvironmentProps) {
  const { t } = useTranslation();
  const text = (key: string) => t('ontology.studio.' + key);
  const [environment, setEnvironment] = useState<IOntologyRuntimeEnvironment>();
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [verification, setVerification] = useState('');
  const [connection, setConnection] = useState<IOntologyPackageResource>();
  const onConfigure = async (bindings: IOntologyRuntimeBindings) => {
    setEnvironment(await api.configure({ workspaceId, bindings }));
    setVerification('');
    await onRefresh();
  };
  useEffect(() => {
    let isCancelled = false;
    void api
      .get({ workspaceId })
      .then((result) => {
        if (!isCancelled) {
          setEnvironment(result);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (!isCancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      isCancelled = true;
    };
  }, [api, workspaceId, revision]);
  const onSave = async () => {
    setIsBusy(true);
    try {
      const bindings = JSON.parse(value) as IOntologyRuntimeBindings;
      setEnvironment(await api.configure({ workspaceId, bindings }));
      setIsEditing(false);
      setVerification('');
      await onRefresh();
      Message.success(text('saved'));
    } catch (reason) {
      onError(reason);
    } finally {
      setIsBusy(false);
    }
  };
  const onVerify = async () => {
    setIsBusy(true);
    try {
      setVerification(JSON.stringify(await api.verify({ workspaceId }), null, 2));
    } catch (reason) {
      onError(reason);
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <Card title={text('runtimeEnvironment')} className='mb-4'>
      <div className='flex flex-col gap-3'>
        <Typography.Text type='secondary'>{text('runtimeEnvironmentHint')}</Typography.Text>
        {error ? (
          <Alert type='error' content={error} />
        ) : !environment ? (
          <Spin />
        ) : (
          <>
            {environment.resources.map((resource) => (
              <div key={resource.id} className='flex items-center gap-2'>
                <Tag color={environment.missingBindings.includes(resource.id) ? 'orange' : 'green'}>{text(environment.missingBindings.includes(resource.id) ? 'bindingMissing' : 'bindingConfigured')}</Tag>
                <span>
                  {resource.name} · {resource.provider}
                </span>
                {workbenchApi && ['sqlite', 'mysql', 'postgresql'].includes(resource.provider) && (
                  <Button size='small' onClick={() => setConnection(resource)}>
                    {text('configureConnection')}
                  </Button>
                )}
                {workbenchApi && resource.provider === 'file' && (
                  <Button
                    size='small'
                    onClick={() => {
                      void workbenchApi
                        .pickDataFiles()
                        .then(async (files) => {
                          if (files[0]) await onConfigure({ files: { [resource.assetIds[0]]: files[0] } });
                        })
                        .catch(onError);
                    }}
                  >
                    {text('bindFile')}
                  </Button>
                )}
              </div>
            ))}
            <Space>
              <Button
                disabled={isBusy}
                onClick={() => {
                  setValue(JSON.stringify(environment.template, null, 2));
                  setIsEditing(true);
                }}
              >
                {text('configureBindings')}
              </Button>
              <Button disabled={!!environment.missingBindings.length} loading={isBusy && !isEditing} onClick={() => void onVerify()}>
                {text('verifyBindings')}
              </Button>
            </Space>
          </>
        )}
        {verification && <pre className='overflow-auto whitespace-pre-wrap'>{verification}</pre>}
      </div>
      <Modal
        visible={isEditing}
        title={text('configureBindings')}
        onCancel={() => {
          if (!isBusy) setIsEditing(false);
        }}
        onOk={onSave}
        confirmLoading={isBusy}
        maskClosable={!isBusy}
        style={{ width: 'min(760px, 92vw)' }}
      >
        <Alert type='info' content={text('bindingEditorHint')} className='mb-3' />
        <Input.TextArea aria-label={text('configureBindings')} value={value} onChange={setValue} autoSize={{ minRows: 12, maxRows: 24 }} disabled={isBusy} />
      </Modal>
      {connection && workbenchApi && (
        <StudioDatabaseConnection
          workspaceId={workspaceId}
          api={workbenchApi}
          initialConnector={connectors.find((item) => item.id === connection.id) || { name: connection.name }}
          providers={[connection.provider as 'sqlite' | 'mysql' | 'postgresql']}
          onClose={() => setConnection(undefined)}
          onError={onError}
          onRefresh={async () => {}}
          onSubmit={async (connector) => {
            const { sourceType, host, port, database, username, password, path, params, writable } = connector;
            await onConfigure({ connections: { [connection.id]: { sourceType, host, port, database, username, password, path, params, writable } } });
          }}
        />
      )}
    </Card>
  );
}

interface IStudioRuntimeEnvironmentProps {
  workspaceId: string;
  revision?: number;
  api: NonNullable<IOntologyStudioApi['runtimeEnvironment']>;
  workbenchApi?: IOntologyStudioApi;
  connectors?: IOntologyConnectorConfig[];
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
}
